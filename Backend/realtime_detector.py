import cv2
import os
import numpy as np
import tensorflow as tf
from mtcnn import MTCNN
from fer import FER
import time
import json
from datetime import datetime
import threading
import queue

# Suppress TensorFlow logs
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

class CheatDetectionSystem:
    def __init__(self, model_path='ssd_mobilenet_v2_coco_2018_03_29/saved_model', 
                 detection_threshold=0.3, mobile_threshold=0.05):
        """
        Initialize the cheat detection system
        
        Args:
            model_path: Path to the TensorFlow saved model
            detection_threshold: Threshold for determining cheating behavior
            mobile_threshold: Threshold for mobile phone detection confidence
        """
        self.detection_threshold = detection_threshold
        self.mobile_threshold = mobile_threshold
        
        # Initialize detectors
        self.mtcnn_detector = MTCNN()
        self.emotion_detector = FER()
        
        # Load mobile detection model
        try:
            self.detection_model = tf.saved_model.load(model_path)
            print("Mobile detection model loaded successfully")
        except Exception as e:
            print(f"Warning: Could not load mobile detection model: {e}")
            self.detection_model = None
        
        # Tracking variables
        self.reset_counters()
        
        # Configuration
        self.frame_skip = 2  # Process every nth frame for performance
        self.frame_counter = 0
        
        # Improved gaze tracking
        self.face_center_history = []
        self.face_history_length = 5  # Reduced for more responsive detection
        self.baseline_face_center = None
        self.baseline_frames = 30  # Frames to establish baseline
        self.baseline_counter = 0
        
        # Alert system
        self.alert_queue = queue.Queue()
        self.real_time_alerts = True
        
        # Looking away tracking
        self.consecutive_looking_away = 0
        self.looking_away_threshold = 5  # Consecutive frames before counting as looking away
        
    def reset_counters(self):
        """Reset all tracking counters"""
        self.total_frames_analyzed = 0  # Only frames actually analyzed
        self.total_frames_captured = 0  # All frames captured
        self.looking_away_frames = 0
        self.mobile_detected_frames = 0
        self.multiple_people_frames = 0
        self.no_face_frames = 0
        self.face_detected_frames = 0
        self.session_start_time = time.time()
        self.baseline_face_center = None
        self.baseline_counter = 0
        self.face_center_history = []
        self.consecutive_looking_away = 0
        
    def detect_mobile_phones(self, frame):
        """
        Detect mobile phones in the frame using TensorFlow model
        
        Args:
            frame: Input frame
            
        Returns:
            List of detected mobile phone bounding boxes with confidence scores
        """
        if self.detection_model is None:
            return []
        
        try:
            # Prepare input tensor
            input_tensor = tf.convert_to_tensor(frame)
            input_tensor = input_tensor[tf.newaxis, ...]
            
            # Perform inference
            detections = self.detection_model.signatures['serving_default'](input_tensor)
            
            # Extract results
            bboxes = detections['detection_boxes'][0].numpy()
            classes = detections['detection_classes'][0].numpy().astype(int)
            scores = detections['detection_scores'][0].numpy()
            
            mobile_detections = []
            for bbox, cls, score in zip(bboxes, classes, scores):
                if cls == 77 and score >= self.mobile_threshold:  # Class 77 is cell phone in COCO
                    mobile_detections.append({
                        'bbox': bbox,
                        'confidence': score
                    })
            
            return mobile_detections
            
        except Exception as e:
            print(f"Error in mobile detection: {e}")
            return []
    
    def calculate_gaze_direction(self, current_center, face_width, frame_width):
        """
        Improved gaze direction calculation based on face position relative to frame center
        
        Args:
            current_center: Current face center coordinates
            face_width: Width of detected face
            frame_width: Width of the frame
            
        Returns:
            Gaze direction string and confidence
        """
        frame_center_x = frame_width // 2
        face_x = current_center[0]
        
        # Calculate relative position
        relative_position = (face_x - frame_center_x) / frame_width
        
        # Establish baseline during first few frames
        if self.baseline_counter < self.baseline_frames:
            if self.baseline_face_center is None:
                self.baseline_face_center = current_center
            else:
                # Update baseline as running average
                self.baseline_face_center = (
                    int((self.baseline_face_center[0] + current_center[0]) / 2),
                    int((self.baseline_face_center[1] + current_center[1]) / 2)
                )
            self.baseline_counter += 1
            return "Calibrating", 0.0
        
        # Calculate deviation from baseline
        if self.baseline_face_center is not None:
            deviation_x = abs(current_center[0] - self.baseline_face_center[0])
            deviation_threshold = face_width * 0.15  # Reduced threshold for more sensitive detection
            
            # Determine direction based on deviation and position
            if deviation_x > deviation_threshold:
                if current_center[0] < self.baseline_face_center[0]:
                    direction = "Left"
                else:
                    direction = "Right"
                confidence = min(deviation_x / (face_width * 0.5), 1.0)
            else:
                direction = "Forward"
                confidence = 1.0 - (deviation_x / deviation_threshold)
        else:
            # Fallback to simple frame-based detection
            if relative_position < -0.1:
                direction = "Left"
                confidence = min(abs(relative_position) * 2, 1.0)
            elif relative_position > 0.1:
                direction = "Right"
                confidence = min(abs(relative_position) * 2, 1.0)
            else:
                direction = "Forward"
                confidence = 1.0 - abs(relative_position) * 2
        
        # Add smoothing with history
        self.face_center_history.append(direction)
        if len(self.face_center_history) > self.face_history_length:
            self.face_center_history.pop(0)
        
        # Use majority vote for smoothing, but don't override strong signals
        if len(self.face_center_history) >= 3 and confidence < 0.8:
            direction_counts = {d: self.face_center_history.count(d) for d in set(self.face_center_history)}
            most_common = max(direction_counts, key=direction_counts.get)
            if direction_counts[most_common] >= 2:
                direction = most_common
                confidence = direction_counts[most_common] / len(self.face_center_history)
        
        return direction, confidence
    
    def generate_alert(self, alert_type, details):
        """Generate alert for suspicious behavior"""
        alert = {
            'timestamp': datetime.now().isoformat(),
            'type': alert_type,
            'details': details
        }
        
        if self.real_time_alerts:
            print(f"ALERT: {alert_type} - {details}")
        
        self.alert_queue.put(alert)
    
    def draw_statistics(self, frame):
        """Draw real-time statistics on the frame"""
        height, width = frame.shape[:2]
        
        # Background for statistics
        overlay = frame.copy()
        cv2.rectangle(overlay, (10, 10), (450, 180), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
        
        # Calculate statistics
        session_time = time.time() - self.session_start_time
        looking_away_pct = (self.looking_away_frames / max(self.total_frames_analyzed, 1)) * 100
        mobile_pct = (self.mobile_detected_frames / max(self.total_frames_analyzed, 1)) * 100
        multiple_people_pct = (self.multiple_people_frames / max(self.total_frames_analyzed, 1)) * 100
        no_face_pct = (self.no_face_frames / max(self.total_frames_analyzed, 1)) * 100
        face_detection_rate = (self.face_detected_frames / max(self.total_frames_analyzed, 1)) * 100
        
        # Display statistics
        stats_text = [
            f"Session Time: {session_time:.1f}s",
            f"Frames Analyzed: {self.total_frames_analyzed}",
            f"Face Detection: {face_detection_rate:.1f}%",
            f"Looking Away: {looking_away_pct:.1f}%",
            f"Mobile Detected: {mobile_pct:.1f}%",
            f"Multiple People: {multiple_people_pct:.1f}%",
            f"No Face: {no_face_pct:.1f}%"
        ]
        
        for i, text in enumerate(stats_text):
            if i == 0:
                color = (0, 255, 0)  # Green for time
            elif i == 2 and face_detection_rate > 80:
                color = (0, 255, 0)  # Green for good face detection
            elif i == 3 and looking_away_pct > 20:
                color = (0, 0, 255)  # Red for high looking away
            elif i == 4 and mobile_pct > 5:
                color = (0, 0, 255)  # Red for mobile detection
            else:
                color = (255, 255, 255)  # White for normal
                
            cv2.putText(frame, text, (15, 35 + i * 20), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    
    def process_frame(self, frame):
        """
        Process a single frame for cheat detection
        
        Args:
            frame: Input frame from camera
            
        Returns:
            Processed frame with annotations
        """
        self.frame_counter += 1
        self.total_frames_captured += 1
        
        # Skip frames for performance, but always count them
        if self.frame_counter % self.frame_skip != 0:
            self.draw_statistics(frame)  # Still show stats on skipped frames
            return frame
        
        # This frame will be analyzed
        self.total_frames_analyzed += 1
        original_frame = frame.copy()
        
        # Detect faces
        detections = self.mtcnn_detector.detect_faces(frame)
        
        # Handle face detection results
        if len(detections) == 0:
            self.no_face_frames += 1
            cv2.putText(frame, "No Face Detected", (50, 50), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            # Reset consecutive looking away counter when no face
            self.consecutive_looking_away = 0
        else:
            self.face_detected_frames += 1
            
            if len(detections) > 1:
                self.multiple_people_frames += 1
                self.generate_alert("Multiple People", f"Detected {len(detections)} faces")
                cv2.putText(frame, f"Multiple People: {len(detections)}", (50, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        
        # Process each detected face
        for i, detection in enumerate(detections):
            if detection['confidence'] < 0.95:  # Only process high-confidence detections
                continue
                
            x, y, w, h = detection['box']
            face_center = (x + w // 2, y + h // 2)
            
            # Draw face rectangle
            cv2.rectangle(frame, (x, y), (x+w, y+h), (255, 0, 0), 2)
            
            # Emotion detection
            try:
                face_region = original_frame[max(0, y):min(frame.shape[0], y+h), 
                                           max(0, x):min(frame.shape[1], x+w)]
                emotion_result = self.emotion_detector.detect_emotions(face_region)
                
                if emotion_result and len(emotion_result) > 0:
                    emotions_dict = emotion_result[0]['emotions']
                    dominant_emotion, confidence = max(emotions_dict.items(), key=lambda x: x[1])
                    
                    # Color code emotions
                    emotion_color = (0, 255, 0) if dominant_emotion in ['happy', 'neutral'] else (0, 165, 255)
                    
                    cv2.putText(frame, f"{dominant_emotion}: {confidence:.2f}", 
                               (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, emotion_color, 2)
                else:
                    cv2.putText(frame, "Emotion: Unknown", (x, y - 10), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            except Exception as e:
                print(f"Emotion detection error: {e}")
            
            # Improved gaze direction calculation
            gaze_direction, gaze_confidence = self.calculate_gaze_direction(
                face_center, w, frame.shape[1])
            
            if gaze_direction != "Calibrating":
                # Color code gaze direction
                gaze_color = (0, 255, 0) if gaze_direction == "Forward" else (0, 165, 255)
                cv2.putText(frame, f"Gaze: {gaze_direction} ({gaze_confidence:.2f})", 
                           (x, y + h + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, gaze_color, 2)
                
                # Improved looking away detection with consecutive frame counting
                if gaze_direction in ["Left", "Right"] and gaze_confidence > 0.4:
                    self.consecutive_looking_away += 1
                    if self.consecutive_looking_away >= self.looking_away_threshold:
                        self.looking_away_frames += 1
                        if self.looking_away_frames % 20 == 0:  # Alert every 20 frames of looking away
                            self.generate_alert("Looking Away", 
                                              f"Direction: {gaze_direction}, Confidence: {gaze_confidence:.2f}")
                else:
                    self.consecutive_looking_away = 0
            else:
                cv2.putText(frame, f"Gaze: {gaze_direction}", 
                           (x, y + h + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
        
        # Detect mobile phones
        mobile_detections = self.detect_mobile_phones(original_frame)
        
        for detection in mobile_detections:
            self.mobile_detected_frames += 1
            bbox = detection['bbox']
            confidence = detection['confidence']
            
            y_min, x_min, y_max, x_max = bbox
            start_point = (int(x_min * frame.shape[1]), int(y_min * frame.shape[0]))
            end_point = (int(x_max * frame.shape[1]), int(y_max * frame.shape[0]))
            
            cv2.rectangle(frame, start_point, end_point, (0, 255, 0), 2)
            cv2.putText(frame, f'Mobile: {confidence:.2f}', 
                       (start_point[0], start_point[1] - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            
            self.generate_alert("Mobile Phone", f"Confidence: {confidence:.2f}")
        
        # Draw statistics overlay
        self.draw_statistics(frame)
        
        return frame
    
    def generate_report(self):
        """Generate a comprehensive detection report"""
        session_time = time.time() - self.session_start_time
        
        report = {
            'session_duration': session_time,
            'total_frames_captured': self.total_frames_captured,
            'total_frames_analyzed': self.total_frames_analyzed,
            'face_detection_rate': (self.face_detected_frames / max(self.total_frames_analyzed, 1)) * 100,
            'statistics': {
                'looking_away_percentage': (self.looking_away_frames / max(self.total_frames_analyzed, 1)) * 100,
                'mobile_detection_percentage': (self.mobile_detected_frames / max(self.total_frames_analyzed, 1)) * 100,
                'multiple_people_percentage': (self.multiple_people_frames / max(self.total_frames_analyzed, 1)) * 100,
                'no_face_percentage': (self.no_face_frames / max(self.total_frames_analyzed, 1)) * 100
            },
            'cheating_detected': {
                'gaze_based': (self.looking_away_frames / max(self.total_frames_analyzed, 1)) > self.detection_threshold,
                'mobile_based': (self.mobile_detected_frames / max(self.total_frames_analyzed, 1)) > self.detection_threshold,
                'multiple_people': (self.multiple_people_frames / max(self.total_frames_analyzed, 1)) > self.detection_threshold
            },
            'alerts': []
        }
        
        # Collect all alerts
        while not self.alert_queue.empty():
            try:
                alert = self.alert_queue.get_nowait()
                report['alerts'].append(alert)
            except queue.Empty:
                break
        
        return report
    
    def run_detection(self, save_report=True, camera_index=0):
        """
        Run the main detection loop
        
        Args:
            save_report: Whether to save detection report to file
            camera_index: Camera index to use
        """
        print("Starting Cheat Detection System...")
        print("Press 'q' to quit, 'r' to reset counters, 's' to save report, 'c' to recalibrate")
        
        # Try different camera indices if the first one fails
        cap = None
        for idx in [camera_index, 0, 1]:
            try:
                cap = cv2.VideoCapture(idx)
                if cap.isOpened():
                    print(f"Successfully opened camera {idx}")
                    break
                else:
                    cap.release()
            except Exception as e:
                print(f"Failed to open camera {idx}: {e}")
        
        if cap is None or not cap.isOpened():
            print("Error: Cannot open any camera")
            return None
        
        # Set camera properties for better performance
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    print("Error: Cannot read frame")
                    break
                
                # Process frame
                processed_frame = self.process_frame(frame)
                
                # Display frame
                cv2.imshow('Cheat Detection System', processed_frame)
                
                # Handle key presses
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('r'):
                    self.reset_counters()
                    print("Counters reset")
                elif key == ord('c'):
                    self.baseline_face_center = None
                    self.baseline_counter = 0
                    print("Recalibrating gaze baseline...")
                elif key == ord('s'):
                    report = self.generate_report()
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"cheat_detection_report_{timestamp}.json"
                    with open(filename, 'w') as f:
                        json.dump(report, f, indent=2)
                    print(f"Report saved to {filename}")
        
        finally:
            cap.release()
            cv2.destroyAllWindows()
        
        # Generate final report
        final_report = self.generate_report()
        
        if save_report:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"cheat_detection_report_{timestamp}.json"
            with open(filename, 'w') as f:
                json.dump(final_report, f, indent=2)
            print(f"Final report saved to {filename}")
        
        # Print summary
        print("\n" + "="*50)
        print("DETECTION SUMMARY")
        print("="*50)
        print(f"Session Duration: {final_report['session_duration']:.1f} seconds")
        print(f"Frames Captured: {final_report['total_frames_captured']}")
        print(f"Frames Analyzed: {final_report['total_frames_analyzed']}")
        print(f"Face Detection Rate: {final_report['face_detection_rate']:.1f}%")
        print(f"Looking Away: {final_report['statistics']['looking_away_percentage']:.1f}%")
        print(f"Mobile Phone Detected: {final_report['statistics']['mobile_detection_percentage']:.1f}%")
        print(f"Multiple People: {final_report['statistics']['multiple_people_percentage']:.1f}%")
        print(f"No Face: {final_report['statistics']['no_face_percentage']:.1f}%")
        print("\nCheating Detected:")
        print(f"  Gaze-based: {final_report['cheating_detected']['gaze_based']}")
        print(f"  Mobile-based: {final_report['cheating_detected']['mobile_based']}")
        print(f"  Multiple people: {final_report['cheating_detected']['multiple_people']}")
        print(f"Total Alerts: {len(final_report['alerts'])}")
        
        return final_report

# Usage example
if __name__ == "__main__":
    # Initialize the detection system
    detector = CheatDetectionSystem(
        model_path='ssd_mobilenet_v2_coco_2018_03_29/saved_model',
        detection_threshold=0.3,
        mobile_threshold=0.05
    )
    
    # Run detection
    report = detector.run_detection(save_report=True)