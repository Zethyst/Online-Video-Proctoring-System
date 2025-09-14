from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import base64
import numpy as np
import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional
import uvicorn
from pydantic import BaseModel
from database import collection

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from realtime_detector import CheatDetectionSystem


class SessionStartRequest(BaseModel):
    session_id: str
    candidate_name: str = "Unknown"
    exam_name: str = ""

class ReportQueryParams(BaseModel):
    limit: Optional[int] = 10
    skip: Optional[int] = 0
    candidate_name: Optional[str] = None
    exam_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class VideoProctorAPI:
    def __init__(self):
        self.app = FastAPI(title="Video Proctoring API")
        
        # CORS middleware for Next.js frontend
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"], 
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        
        # Active sessions storage
        self.active_sessions: Dict[str, dict] = {}
        self.detection_systems: Dict[str, 'CheatDetectionSystem'] = {}
        
    
    def setup_routes(self):
        @self.app.get("/")
        async def root():
            return {"message": "Video Proctoring API is running"}
        
        @self.app.get("/health")
        async def health_check():
            return {"status": "healthy", "timestamp": datetime.now().isoformat()}
        
        @self.app.post("/api/session/start")
        async def start_session(session_data: SessionStartRequest):
            """Start a new proctoring session"""
            session_id = session_data.session_id
            candidate_name = session_data.candidate_name
            
            if session_id in self.active_sessions:
                raise HTTPException(status_code=400, detail="Session already exists")
            
            try:
                # Import here to avoid circular import issues
                from realtime_detector import CheatDetectionSystem
                
                # Initialize detection system for this session
                detector = CheatDetectionSystem(
                    model_path='ssd_mobilenet_v2_coco_2018_03_29/saved_model',
                    detection_threshold=0.3,
                    mobile_threshold=0.05
                )
                
                self.active_sessions[session_id] = {
                    "candidate_name": candidate_name,
                    "exam_name": session_data.exam_name,
                    "start_time": datetime.now(),
                    "status": "active",
                    "alerts": [],
                    "stats": {
                        "total_frames_analyzed": 0,
                        "total_frames_captured": 0,
                        "face_detected_frames": 0,
                        "looking_away_frames": 0,
                        "mobile_detected_frames": 0,
                        "multiple_people_frames": 0,
                        "no_face_frames": 0,
                        "face_detection_rate": 0.0
                    }
                }
                
                self.detection_systems[session_id] = detector
                
                return {
                    "message": "Session started successfully", 
                    "session_id": session_id,
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error starting session: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to initialize detection system: {str(e)}")
        
        @self.app.post("/api/session/{session_id}/end")
        async def end_session(session_id: str):
            """End a proctoring session and generate report"""
            if session_id not in self.active_sessions:
                raise HTTPException(status_code=404, detail="Session not found")
            
            try:
                session = self.active_sessions[session_id]
                detector = self.detection_systems[session_id]
                
                # Generate final report
                report = detector.generate_report()
                
                # Calculate integrity score
                integrity_score = self.calculate_integrity_score(report)
                
                # Update session status
                session["status"] = "completed"
                session["end_time"] = datetime.now()
                session["final_report"] = report
                session["integrity_score"] = integrity_score
                
                # Prepare report data for database
                report_data = {
                    "session_id": session_id,
                    "candidate_name": session["candidate_name"],
                    "exam_name": session.get("exam_name", ""),
                    "start_time": session["start_time"],
                    "end_time": session["end_time"],
                    "status": session["status"],
                    "detection_report": report,
                    "integrity_score": integrity_score,
                    "alerts": session["alerts"],
                    "stats": session["stats"],
                    "alert_summary": {
                        "total_alerts": len(session["alerts"]),
                        "alert_types": self.get_alert_summary(session["alerts"])
                    },
                    "created_at": datetime.now(),
                    "duration_seconds": (session["end_time"] - session["start_time"]).total_seconds()
                }
                
                # Save to database
                try:
                    result = await collection.insert_one(report_data)
                    database_id = str(result.inserted_id)
                    print(f"Report saved to database with ID: {database_id}")
                except Exception as db_error:
                    print(f"Error saving to database: {db_error}")
                    # Continue even if database save fails
                    database_id = None
                
                # Clean up detector
                del self.detection_systems[session_id]
                
                return {
                    "message": "Session ended successfully",
                    "session_id": session_id,
                    "database_id": database_id,
                    "report": report,
                    "integrity_score": integrity_score,
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error ending session: {e}")
                raise HTTPException(status_code=500, detail=f"Error ending session: {str(e)}")
        
        @self.app.websocket("/ws/{session_id}")
        async def websocket_endpoint(websocket: WebSocket, session_id: str):
            """WebSocket endpoint for real-time video processing"""
            await websocket.accept()
            print(f"WebSocket connection accepted for session: {session_id}")
            
            if session_id not in self.active_sessions:
                try:
                    await websocket.send_text(json.dumps({
                        "error": "Session not found",
                        "session_id": session_id
                    }))
                    await websocket.close()
                except:
                    pass
                return
            
            detector = self.detection_systems[session_id]
            session = self.active_sessions[session_id]
            
            try:
                while True:
                    # Receive frame data from frontend
                    try:
                        data = await websocket.receive_text()
                        frame_data = json.loads(data)
                    except WebSocketDisconnect:
                        print(f"WebSocket disconnected for session {session_id}")
                        break
                    except Exception as e:
                        print(f"Error receiving WebSocket data: {e}")
                        # If we can't receive data, the connection might be broken
                        break
                    
                    # Decode base64 frame
                    try:
                        # Remove data URL prefix if present
                        frame_b64 = frame_data["frame"]
                        if frame_b64.startswith("data:image"):
                            frame_b64 = frame_b64.split(",")[1]
                        
                        frame_bytes = base64.b64decode(frame_b64)
                        nparr = np.frombuffer(frame_bytes, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        
                        if frame is None:
                            print("Failed to decode frame")
                            continue
                        
                        # Process frame with your detection system
                        processed_frame = detector.process_frame(frame)
                        
                        # Update session statistics
                        self.update_session_stats(session_id, detector)
                        
                        # Get recent alerts
                        alerts = self.get_recent_alerts(detector)
                        
                        # Add alerts to session history
                        session["alerts"].extend(alerts)
                        
                        # Keep only recent alerts (last 100)
                        if len(session["alerts"]) > 100:
                            session["alerts"] = session["alerts"][-100:]
                        
                        # Encode processed frame for debugging (optional)
                        processed_frame_b64 = None
                        if frame_data.get("return_processed", False):
                            _, buffer = cv2.imencode('.jpg', processed_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                            processed_frame_b64 = base64.b64encode(buffer).decode()
                        
                        # Calculate current integrity score
                        temp_report = detector.generate_report()
                        current_integrity = self.calculate_integrity_score(temp_report)
                        
                        # Send response
                        response = {
                            "status": "success",
                            "session_id": session_id,
                            "alerts": alerts,
                            "stats": session["stats"],
                            "integrity_score": current_integrity,
                            "timestamp": datetime.now().isoformat()
                        }
                        
                        if processed_frame_b64:
                            response["processed_frame"] = processed_frame_b64
                        
                        try:
                            await websocket.send_text(json.dumps(response))
                        except WebSocketDisconnect:
                            print(f"WebSocket disconnected while sending response for session {session_id}")
                            break
                        except Exception as send_error:
                            print(f"Error sending WebSocket response: {send_error}")
                            break
                        
                    except Exception as e:
                        print(f"Error processing frame: {e}")
                        try:
                            await websocket.send_text(json.dumps({
                                "error": f"Frame processing error: {str(e)}",
                                "timestamp": datetime.now().isoformat()
                            }))
                        except (WebSocketDisconnect, Exception):
                            print(f"Cannot send error message, WebSocket likely disconnected")
                            break
                    
            except WebSocketDisconnect:
                print(f"WebSocket disconnected for session {session_id}")
            except Exception as e:
                print(f"Unexpected error in WebSocket: {e}")
            finally:
                print(f"Cleaning up WebSocket connection for session {session_id}")
        
        @self.app.get("/api/session/{session_id}/report")
        async def get_session_report(session_id: str):
            """Get detailed session report"""
            if session_id not in self.active_sessions:
                raise HTTPException(status_code=404, detail="Session not found")
            
            session = self.active_sessions[session_id]
            
            try:
                if "final_report" not in session and session_id in self.detection_systems:
                    # Generate interim report
                    detector = self.detection_systems[session_id]
                    report = detector.generate_report()
                    integrity_score = self.calculate_integrity_score(report)
                elif "final_report" in session:
                    report = session["final_report"]
                    integrity_score = session["integrity_score"]
                else:
                    raise HTTPException(status_code=400, detail="No report data available")
                
                return {
                    "session_info": {
                        "session_id": session_id,
                        "candidate_name": session["candidate_name"],
                        "exam_name": session.get("exam_name", ""),
                        "start_time": session["start_time"].isoformat(),
                        "end_time": session.get("end_time", datetime.now()).isoformat(),
                        "status": session["status"]
                    },
                    "detection_report": report,
                    "integrity_score": integrity_score,
                    "alerts_summary": {
                        "total_alerts": len(session["alerts"]),
                        "alert_types": self.get_alert_summary(session["alerts"])
                    }
                }
                
            except Exception as e:
                print(f"Error generating report: {e}")
                raise HTTPException(status_code=500, detail=f"Error generating report: {str(e)}")
        
        @self.app.get("/api/reports")
        async def get_all_reports(
            limit: int = 10,
            skip: int = 0,
            candidate_name: Optional[str] = None,
            exam_name: Optional[str] = None,
            start_date: Optional[str] = None,
            end_date: Optional[str] = None
        ):
            """Get all saved reports with optional filtering"""
            try:
                # Build query filter
                query_filter = {}
                
                if candidate_name:
                    query_filter["candidate_name"] = {"$regex": candidate_name, "$options": "i"}
                
                if exam_name:
                    query_filter["exam_name"] = {"$regex": exam_name, "$options": "i"}
                
                if start_date:
                    try:
                        start_datetime = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                        query_filter["start_time"] = {"$gte": start_datetime}
                    except ValueError:
                        raise HTTPException(status_code=400, detail="Invalid start_date format. Use ISO format.")
                
                if end_date:
                    try:
                        end_datetime = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                        if "start_time" in query_filter:
                            query_filter["start_time"]["$lte"] = end_datetime
                        else:
                            query_filter["start_time"] = {"$lte": end_datetime}
                    except ValueError:
                        raise HTTPException(status_code=400, detail="Invalid end_date format. Use ISO format.")
                
                # Get total count for pagination
                total_count = await collection.count_documents(query_filter)
                
                # Get paginated results
                cursor = collection.find(query_filter).sort("created_at", -1).skip(skip).limit(limit)
                reports = []
                
                async for doc in cursor:
                    # Convert ObjectId to string
                    doc["_id"] = str(doc["_id"])
                    
                    # Convert datetime objects to ISO strings
                    if "start_time" in doc and isinstance(doc["start_time"], datetime):
                        doc["start_time"] = doc["start_time"].isoformat()
                    if "end_time" in doc and isinstance(doc["end_time"], datetime):
                        doc["end_time"] = doc["end_time"].isoformat()
                    if "created_at" in doc and isinstance(doc["created_at"], datetime):
                        doc["created_at"] = doc["created_at"].isoformat()
                    
                    reports.append(doc)
                
                return {
                    "reports": reports,
                    "pagination": {
                        "total": total_count,
                        "limit": limit,
                        "skip": skip,
                        "page": (skip // limit) + 1,
                        "total_pages": (total_count + limit - 1) // limit
                    },
                    "filters_applied": {
                        "candidate_name": candidate_name,
                        "exam_name": exam_name,
                        "start_date": start_date,
                        "end_date": end_date
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error fetching reports: {e}")
                raise HTTPException(status_code=500, detail=f"Error fetching reports: {str(e)}")
        
        @self.app.get("/api/reports/{report_id}")
        async def get_report_by_id(report_id: str):
            """Get a specific report by database ID"""
            try:
                from bson import ObjectId
                
                # Convert string ID to ObjectId
                if not ObjectId.is_valid(report_id):
                    raise HTTPException(status_code=400, detail="Invalid report ID format")
                
                report = await collection.find_one({"_id": ObjectId(report_id)})
                
                if not report:
                    raise HTTPException(status_code=404, detail="Report not found")
                
                # Convert ObjectId to string
                report["_id"] = str(report["_id"])
                
                # Convert datetime objects to ISO strings
                if "start_time" in report and isinstance(report["start_time"], datetime):
                    report["start_time"] = report["start_time"].isoformat()
                if "end_time" in report and isinstance(report["end_time"], datetime):
                    report["end_time"] = report["end_time"].isoformat()
                if "created_at" in report and isinstance(report["created_at"], datetime):
                    report["created_at"] = report["created_at"].isoformat()
                
                return {
                    "report": report,
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error fetching report by ID: {e}")
                raise HTTPException(status_code=500, detail=f"Error fetching report: {str(e)}")
        
        @self.app.delete("/api/reports/{report_id}")
        async def delete_report(report_id: str):
            """Delete a specific report by database ID"""
            try:
                from bson import ObjectId
                
                # Convert string ID to ObjectId
                if not ObjectId.is_valid(report_id):
                    raise HTTPException(status_code=400, detail="Invalid report ID format")
                
                result = await collection.delete_one({"_id": ObjectId(report_id)})
                
                if result.deleted_count == 0:
                    raise HTTPException(status_code=404, detail="Report not found")
                
                return {
                    "message": "Report deleted successfully",
                    "report_id": report_id,
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error deleting report: {e}")
                raise HTTPException(status_code=500, detail=f"Error deleting report: {str(e)}")
        
        @self.app.get("/api/reports/stats/summary")
        async def get_reports_summary():
            """Get summary statistics of all reports"""
            try:
                # Get total reports count
                total_reports = await collection.count_documents({})
                
                # Get reports by status
                pipeline_status = [
                    {"$group": {"_id": "$status", "count": {"$sum": 1}}}
                ]
                status_stats = []
                async for doc in collection.aggregate(pipeline_status):
                    status_stats.append({"status": doc["_id"], "count": doc["count"]})
                
                # Get average integrity score
                pipeline_integrity = [
                    {"$group": {"_id": None, "avg_integrity": {"$avg": "$integrity_score"}}}
                ]
                avg_integrity = 0
                async for doc in collection.aggregate(pipeline_integrity):
                    avg_integrity = round(doc["avg_integrity"], 2)
                
                # Get recent reports (last 7 days)
                seven_days_ago = datetime.now() - timedelta(days=7)
                recent_reports = await collection.count_documents({"created_at": {"$gte": seven_days_ago}})
                
                # Get top alert types
                pipeline_alerts = [
                    {"$unwind": "$alerts"},
                    {"$group": {"_id": "$alerts.type", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                    {"$limit": 5}
                ]
                top_alerts = []
                async for doc in collection.aggregate(pipeline_alerts):
                    top_alerts.append({"type": doc["_id"], "count": doc["count"]})
                
                return {
                    "summary": {
                        "total_reports": total_reports,
                        "recent_reports_7_days": recent_reports,
                        "average_integrity_score": avg_integrity,
                        "reports_by_status": status_stats,
                        "top_alert_types": top_alerts
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                print(f"Error generating summary: {e}")
                raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")
        
        @self.app.get("/api/sessions")
        async def list_sessions():
            """List all active sessions"""
            sessions = []
            for session_id, session_data in self.active_sessions.items():
                session_info = {
                    "session_id": session_id,
                    "candidate_name": session_data["candidate_name"],
                    "exam_name": session_data.get("exam_name", ""),
                    "start_time": session_data["start_time"].isoformat(),
                    "status": session_data["status"],
                    "alert_count": len(session_data.get("alerts", []))
                }
                
                if "end_time" in session_data:
                    session_info["end_time"] = session_data["end_time"].isoformat()
                    
                if "integrity_score" in session_data:
                    session_info["integrity_score"] = session_data["integrity_score"]
                
                sessions.append(session_info)
            
            return {
                "sessions": sessions,
                "total_sessions": len(sessions),
                "timestamp": datetime.now().isoformat()
            }
        
        @self.app.delete("/api/session/{session_id}")
        async def delete_session(session_id: str):
            """Delete a session"""
            if session_id not in self.active_sessions:
                raise HTTPException(status_code=404, detail="Session not found")
            
            try:
                # Clean up detection system if still active
                if session_id in self.detection_systems:
                    del self.detection_systems[session_id]
                
                # Remove session
                del self.active_sessions[session_id]
                
                return {
                    "message": "Session deleted successfully",
                    "session_id": session_id,
                    "timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Error deleting session: {str(e)}")
    
    def update_session_stats(self, session_id: str, detector):
        """Update session statistics"""
        session = self.active_sessions[session_id]
        
        # Calculate face detection rate
        face_detection_rate = 0.0
        if detector.total_frames_analyzed > 0:
            face_detection_rate = (detector.face_detected_frames / detector.total_frames_analyzed) * 100
        
        session["stats"] = {
            "total_frames_analyzed": detector.total_frames_analyzed,
            "total_frames_captured": detector.total_frames_captured,
            "face_detected_frames": detector.face_detected_frames,
            "looking_away_frames": detector.looking_away_frames,
            "mobile_detected_frames": detector.mobile_detected_frames,
            "multiple_people_frames": detector.multiple_people_frames,
            "no_face_frames": detector.no_face_frames,
            "face_detection_rate": face_detection_rate
        }
    
    def get_recent_alerts(self, detector) -> List[dict]:
        """Get recent alerts from detector"""
        alerts = []
        while not detector.alert_queue.empty():
            try:
                alert = detector.alert_queue.get_nowait()
                alerts.append(alert)
            except:
                break
        return alerts
    
    def get_alert_summary(self, alerts: List[dict]) -> dict:
        """Generate alert type summary"""
        summary = {}
        for alert in alerts:
            alert_type = alert.get("type", "Unknown")
            summary[alert_type] = summary.get(alert_type, 0) + 1
        return summary
    
    def calculate_integrity_score(self, report: dict) -> int:
        """Calculate integrity score based on detection results"""
        base_score = 100
        
        # Get statistics
        stats = report.get("statistics", {})
        
        # Looking away deductions
        looking_away_pct = stats.get("looking_away_percentage", 0)
        if looking_away_pct > 20:
            base_score -= min(30, int(looking_away_pct))
        elif looking_away_pct > 10:
            base_score -= min(15, int(looking_away_pct / 2))
        
        # Mobile phone deductions
        mobile_pct = stats.get("mobile_detection_percentage", 0)
        if mobile_pct > 5:
            base_score -= min(25, int(mobile_pct * 2))
        elif mobile_pct > 2:
            base_score -= min(10, int(mobile_pct))
        
        # Multiple people deductions
        multiple_people_pct = stats.get("multiple_people_percentage", 0)
        if multiple_people_pct > 2:
            base_score -= min(20, int(multiple_people_pct * 5))
        
        # No face deductions (less severe, could be technical issues)
        no_face_pct = stats.get("no_face_percentage", 0)
        if no_face_pct > 15:
            base_score -= min(15, int(no_face_pct / 2))
        elif no_face_pct > 30:
            base_score -= min(25, int(no_face_pct / 3))
        
        # Bonus for good face detection rate
        face_detection_rate = report.get("face_detection_rate", 0)
        if face_detection_rate > 90:
            base_score += 5
        
        return max(0, min(100, base_score))

# Initialize the API
api = VideoProctorAPI()
api.setup_routes()  # Don't forget to call setup_routes()
app = api.app

if __name__ == "__main__":
    print("Starting Video Proctoring API...")
    print("API will be available at: http://localhost:8000")
    print("WebSocket endpoint: ws://localhost:8000/ws/{session_id}")
    print("API docs: http://localhost:8000/docs")
    print("New endpoints:")
    print("  GET /api/reports - Get all reports with filtering")
    print("  GET /api/reports/{report_id} - Get specific report")
    print("  DELETE /api/reports/{report_id} - Delete specific report")
    print("  GET /api/reports/stats/summary - Get summary statistics")
    
    uvicorn.run(
        "server:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info"
    )