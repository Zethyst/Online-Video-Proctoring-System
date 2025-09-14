"use client"
import React, { useState, useRef, useEffect } from 'react';
import {
    Camera, User, Clock, Activity, AlertTriangle, Shield, Eye, Users, Smartphone,
    FileText, Download, X, CheckCircle, XCircle, AlertOctagon, Phone, BookOpen,
    Calendar, Timer, TrendingDown, Award, Loader2,
    Loader
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import ReportModal from './ReportModal';
import OldReports from './OldReports';

const VideoProctoring = () => {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const [candidateName, setCandidateName] = useState('');
    const [alerts, setAlerts] = useState([]);
    const [stats, setStats] = useState({
        total_frames_captured: 0,
        looking_away_frames: 0,
        mobile_detected_frames: 0,
        multiple_people_frames: 0,
        no_face_frames: 0
    });
    const [sessionTime, setSessionTime] = useState(0);
    const [integrityScore, setIntegrityScore] = useState(100);
    const [showReport, setShowReport] = useState(false);
    const [sessionReport, setSessionReport] = useState(null);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const wsRef = useRef(null);
    const intervalRef = useRef(null);
    const streamRef = useRef(null);


    useEffect(() => {
        if (isSessionActive) {
            startVideoCapture();
            startWebSocket();
            startTimer();
        } else {
            stopVideoCapture();
            stopWebSocket();
            stopTimer();
        }

        return () => {
            stopVideoCapture();
            stopWebSocket();
            stopTimer();
        };
    }, [isSessionActive]);

    const startTimer = () => {
        const startTime = Date.now();
        intervalRef.current = setInterval(() => {
            setSessionTime(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
    };

    const stopTimer = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };

    const startVideoCapture = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (error) {
            console.error('Error accessing camera:', error);
            toast.error('Unable to access camera. Please check permissions.');
        }
    };

    const stopVideoCapture = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
    };

    const startWebSocket = () => {
        wsRef.current = new WebSocket(`${process.env.NEXT_PUBLIC_SOCKET_URL}/ws/${sessionId}`);

        wsRef.current.onopen = () => {
            console.log('WebSocket connected');
            captureAndSendFrame();
        };

        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.error) {
                console.error('WebSocket error:', data.error);
                return;
            }

            // Update alerts
            if (data.alerts && data.alerts.length > 0) {
                setAlerts(prev => [...prev, ...data.alerts].slice(-10)); // Keep last 10 alerts
            }

            // Update stats
            console.log("stats: ", data.stats);

            if (data.stats) {
                setStats(data.stats);
                // Calculate live integrity score
                calculateIntegrityScore(data.stats);
            }

            // Continue capturing frames
            setTimeout(captureAndSendFrame, 100); // 10 FPS
        };

        wsRef.current.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        wsRef.current.onclose = () => {
            console.log('WebSocket closed');
        };
    };

    const stopWebSocket = () => {
        if (wsRef.current) {
            wsRef.current.close();
        }
    };

    const captureAndSendFrame = () => {
        if (!videoRef.current || !canvasRef.current || !wsRef.current) return;

        const canvas = canvasRef.current;
        const video = videoRef.current;
        const ctx = canvas.getContext('2d');

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
            if (blob) {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            frame: base64,
                            timestamp: Date.now()
                        }));
                    }
                };
                reader.readAsDataURL(blob);
            }
        }, 'image/jpeg', 0.8);
    };

    const calculateIntegrityScore = (currentStats) => {
        let score = 100;
        const totalFrames = currentStats.total_frames_captured || 1;

        const lookingAwayPct = (currentStats.looking_away_frames / totalFrames) * 100;
        const mobilePct = (currentStats.mobile_detected_frames / totalFrames) * 100;
        const multiplePeoplePct = (currentStats.multiple_people_frames / totalFrames) * 100;
        const noFacePct = (currentStats.no_face_frames / totalFrames) * 100;

        // Create deductions array for the report
        const deductions = [];

        if (lookingAwayPct > 20) {
            const deduction = Math.min(30, lookingAwayPct);
            score -= deduction;
            deductions.push({ reason: "Looking Away", deduction, percentage: lookingAwayPct.toFixed(1) });
        }
        if (mobilePct > 5) {
            const deduction = Math.min(25, mobilePct * 2);
            score -= deduction;
            deductions.push({ reason: "Mobile Device", deduction, percentage: mobilePct.toFixed(1) });
        }
        if (multiplePeoplePct > 2) {
            const deduction = Math.min(20, multiplePeoplePct * 5);
            score -= deduction;
            deductions.push({ reason: "Multiple People", deduction, percentage: multiplePeoplePct.toFixed(1) });
        }
        if (noFacePct > 10) {
            const deduction = Math.min(15, noFacePct);
            score -= deduction;
            deductions.push({ reason: "Face Not Visible", deduction, percentage: noFacePct.toFixed(1) });
        }

        const finalScore = Math.max(0, Math.floor(score));
        setIntegrityScore(finalScore);

        return { score: finalScore, deductions };
    };

    const startSession = async () => {
        if (!candidateName.trim()) {
            toast.error('Please enter candidate name');
            return;
        }
        setLoading(true);
        const newSessionId = `session_${Date.now()}`;

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: newSessionId,
                    candidate_name: candidateName
                })
            });

            if (response.ok) {
                setSessionId(newSessionId);
                setIsSessionActive(true);
                setAlerts([]);
                setStats({
                    total_frames_captured: 0,
                    looking_away_frames: 0,
                    mobile_detected_frames: 0,
                    multiple_people_frames: 0,
                    no_face_frames: 0
                });
            } else {
                toast.error('Failed to start session');
            }
        } catch (error) {
            console.error('Error starting session:', error);
            toast.error('Error starting session');
        }
        finally {
            setLoading(false);
        }
    };

    const endSession = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/${sessionId}/end`, {
                method: 'POST'
            });

            if (response.ok) {
                const result = await response.json();
                setIntegrityScore(result.integrity_score);
                setIsSessionActive(false);
            }
        } catch (error) {
            console.error('Error ending session:', error);
        }
        finally {
            setLoading(false);
            generateReport();
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getScoreColor = (score) => {
        if (score >= 80) return 'text-green-500';
        if (score >= 60) return 'text-yellow-500';
        return 'text-red-500';
    };

    const getScoreColorBg = (score) => {
        if (score >= 80) return 'from-emerald-600 to-green-600';
        if (score >= 60) return 'from-yellow-600 to-orange-600';
        return 'from-red-600 to-pink-600';
    };

    const getAlertTypeIcon = (type) => {
        switch (type) {
            case "Looking Away": return <Eye className="w-4 h-4" />;
            case "Mobile Detected": return <Smartphone className="w-4 h-4" />;
            case "Multiple People": return <Users className="w-4 h-4" />;
            default: return <AlertTriangle className="w-4 h-4" />;
        }
    };

    const getAlertTypeColor = (type) => {
        switch (type) {
            case "Looking Away": return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
            case "Mobile Detected": return 'border-red-500/30 bg-red-500/10 text-red-300';
            case "Multiple People": return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
            default: return 'border-gray-500/30 bg-gray-500/10 text-gray-300';
        }
    };

    const generateReport = () => {
        const { score, deductions } = calculateIntegrityScore(stats);
        const duration = formatTime(sessionTime);

        const suspiciousEvents = alerts.reduce((acc, alert) => {
            const key = alert.type;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        const report = {
            candidateName,
            sessionId,
            sessionDate: new Date().toLocaleDateString(),
            sessionTime: new Date().toLocaleTimeString(),
            duration,
            durationSeconds: sessionTime,
            totalFrames: stats.total_frames_captured,
            integrityScore: score,
            deductions,
            suspiciousEvents,
            detailedStats: {
                focusLost: stats.looking_away_frames,
                mobileDetected: stats.mobile_detected_frames,
                multiplePeople: stats.multiple_people_frames,
                noFaceDetected: stats.no_face_frames
            },
            alertLog: alerts.map(alert => ({
                ...alert,
                timestamp: new Date(alert.timestamp).toLocaleTimeString()
            })),
            recommendations: generateRecommendations(score, deductions)
        };

        setSessionReport(report);
        setShowReport(true);
    };

    const generateRecommendations = (score, deductions) => {
        const recommendations = [];

        if (score >= 90) {
            recommendations.push("Excellent performance with minimal violations detected.");
        } else if (score >= 75) {
            recommendations.push("Good performance with minor violations. Consider reviewing flagged incidents.");
        } else if (score >= 60) {
            recommendations.push("Moderate violations detected. Manual review recommended.");
        } else {
            recommendations.push("Significant violations detected. Immediate review required.");
        }

        deductions.forEach(deduction => {
            switch (deduction.reason) {
                case "Looking Away":
                    recommendations.push("Candidate frequently looked away from screen. Verify exam environment.");
                    break;
                case "Mobile Device":
                    recommendations.push("Mobile device detected. Investigate potential unauthorized assistance.");
                    break;
                case "Multiple People":
                    recommendations.push("Multiple people detected. Verify candidate identity and exam integrity.");
                    break;
                case "Face Not Visible":
                    recommendations.push("Face frequently not visible. Check camera setup and candidate positioning.");
                    break;
            }
        });

        return recommendations;
    };

    const downloadPDF = async () => {
        if (!sessionReport) return;

        // Create a new window for PDF generation
        const printWindow = window.open('', '_blank');

        const pdfContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Proctoring Report - ${sessionReport.candidateName}</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    margin: 0;
                    padding: 20px;
                    line-height: 1.6;
                    color: #333;
                    background: white;
                }
                .header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 30px;
                    margin: -20px -20px 30px -20px;
                    text-align: center;
                    border-radius: 0 0 15px 15px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 2.5em;
                    font-weight: 700;
                }
                .header p {
                    margin: 10px 0 0 0;
                    opacity: 0.9;
                    font-size: 1.1em;
                }
                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 30px;
                    margin-bottom: 30px;
                }
                .info-section {
                    background: #f8fafc;
                    padding: 20px;
                    border-radius: 10px;
                    border-left: 4px solid #667eea;
                }
                .info-section h3 {
                    margin-top: 0;
                    color: #2d3748;
                    font-size: 1.2em;
                    font-weight: 600;
                }
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #e2e8f0;
                }
                .info-row:last-child {
                    border-bottom: none;
                }
                .score-section {
                    text-align: center;
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    color: white;
                    padding: 30px;
                    border-radius: 15px;
                    margin: 30px 0;
                }
                .score-value {
                    font-size: 4em;
                    font-weight: bold;
                    margin: 10px 0;
                }
                .score-label {
                    font-size: 1.2em;
                    opacity: 0.9;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    margin: 30px 0;
                }
                .stat-card {
                    background: white;
                    border: 2px solid #e2e8f0;
                    border-radius: 10px;
                    padding: 20px;
                    text-align: center;
                }
                .stat-value {
                    font-size: 2em;
                    font-weight: bold;
                    color: #667eea;
                }
                .stat-label {
                    color: #64748b;
                    margin-top: 5px;
                }
                .section {
                    margin: 30px 0;
                    background: white;
                    padding: 25px;
                    border-radius: 10px;
                    border: 1px solid #e2e8f0;
                }
                .section h3 {
                    margin-top: 0;
                    color: #2d3748;
                    border-bottom: 2px solid #667eea;
                    padding-bottom: 10px;
                }
                .alert-item {
                    background: #fef2f2;
                    border-left: 4px solid #ef4444;
                    padding: 15px;
                    margin: 10px 0;
                    border-radius: 0 8px 8px 0;
                }
                .recommendation {
                    background: #f0f9ff;
                    border-left: 4px solid #0ea5e9;
                    padding: 15px;
                    margin: 10px 0;
                    border-radius: 0 8px 8px 0;
                }
                .deduction-item {
                    background: #fefce8;
                    border-left: 4px solid #eab308;
                    padding: 15px;
                    margin: 10px 0;
                    border-radius: 0 8px 8px 0;
                }
                .footer {
                    margin-top: 50px;
                    text-align: center;
                    color: #64748b;
                    font-size: 0.9em;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 20px;
                }
                @media print {
                    body { margin: 0; }
                    .header { margin: 0 0 30px 0; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🛡️ Proctoring Report</h1>
                <p>Comprehensive Proctoring Analysis & Integrity Assessment</p>
            </div>

            <div class="info-grid">
                <div class="info-section">
                    <h3>👤 Candidate Information</h3>
                    <div class="info-row">
                        <span><strong>Name:</strong></span>
                        <span>${sessionReport.candidateName}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Session ID:</strong></span>
                        <span>${sessionReport.sessionId}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Date:</strong></span>
                        <span>${sessionReport.sessionDate}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Start Time:</strong></span>
                        <span>${sessionReport.sessionTime}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Duration:</strong></span>
                        <span>${sessionReport.duration}</span>
                    </div>
                </div>

                <div class="info-section">
                    <h3>📊 Session Overview</h3>
                    <div class="info-row">
                        <span><strong>Total Frames:</strong></span>
                        <span>${sessionReport.totalFrames.toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Alerts Generated:</strong></span>
                        <span>${sessionReport.alertLog.length}</span>
                    </div>
                    <div class="info-row">
                        <span><strong>Final Status:</strong></span>
                        <span>${sessionReport.integrityScore >= 80 ? '✅ Passed' : sessionReport.integrityScore >= 60 ? '⚠️ Review Required' : '❌ Failed'}</span>
                    </div>
                </div>
            </div>

            <div class="score-section">
                <div class="score-label">Final Integrity Score</div>
                <div class="score-value">${sessionReport.integrityScore}/100</div>
                <div class="score-label">${sessionReport.integrityScore >= 80 ? 'Excellent Performance' : sessionReport.integrityScore >= 60 ? 'Good Performance' : 'Requires Review'}</div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${sessionReport.detailedStats.focusLost}</div>
                    <div class="stat-label">👀 Looking Away Incidents</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${sessionReport.detailedStats.mobileDetected}</div>
                    <div class="stat-label">📱 Mobile Device Detections</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${sessionReport.detailedStats.multiplePeople}</div>
                    <div class="stat-label">👥 Multiple People Detected</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${sessionReport.detailedStats.noFaceDetected}</div>
                    <div class="stat-label">😶 No Face Detected</div>
                </div>
            </div>

            ${sessionReport?.deductions?.length > 0 ? `
            <div class="section">
                <h3>📉 Score Deductions</h3>
                ${sessionReport.deductions.map(deduction => `
                    <div class="deduction-item">
                        <strong>${deduction.reason}:</strong> -${deduction.deduction} points (${deduction.percentage}% of session)
                    </div>
                `).join('')}
            </div>
            ` : ''}

            ${sessionReport.alertLog.length > 0 ? `
            <div class="section">
                <h3>🚨 Alert Log</h3>
                ${sessionReport.alertLog.slice(0, 10).map(alert => `
                    <div class="alert-item">
                        <strong>${alert.timestamp}:</strong> ${alert.type} - ${alert.details}
                    </div>
                `).join('')}
                ${sessionReport.alertLog.length > 10 ? `<p><em>... and ${sessionReport.alertLog.length - 10} more alerts</em></p>` : ''}
            </div>
            ` : ''}

            <div class="section">
                <h3>💡 Recommendations</h3>
                ${sessionReport.recommendations.map(rec => `
                    <div class="recommendation">
                        ${rec}
                    </div>
                `).join('')}
            </div>

            <div class="footer">
                <p>Report generated on ${new Date().toLocaleString()}</p>
                <p>This report contains confidential information and should be handled according to your institution's privacy policies.</p>
            </div>
        </body>
        </html>
        `;

        printWindow.document.write(pdfContent);
        printWindow.document.close();

        // Wait for content to load then trigger print
        printWindow.onload = () => {
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 500);
        };
    };


    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 p-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="bg-white/90 backdrop-blur-xl border border-purple-200/50 rounded-2xl shadow-lg p-8 mb-8">
                    <h1 className="text-4xl font-bold text-[#800080] mb-6 flex items-center">
                        <div className="bg-gradient-to-r from-[#aa00aa] to-[#5a005a] p-3 rounded-xl mr-4 shadow-md">
                            <Shield className="w-8 h-8 text-white" />
                        </div>
                        Video Proctoring System
                    </h1>

                    {!isSessionActive ? (
                        <div className="flex items-center space-x-4">
                            <div className="flex-1 relative">
                                <User className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-800 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Enter candidate name"
                                    value={candidateName}
                                    onChange={(e) => setCandidateName(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-white/70 border border-purple-200 rounded-xl text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:border-purple-400/50 backdrop-blur-sm transition-all"
                                />
                            </div>
                            <button
                                onClick={startSession}
                                disabled={!candidateName.trim()}
                                className="px-8 py-4 bg-gradient-to-r from-[#aa00aa] to-[#5a005a] hover:from-[#840184] hover:to-[#360036] cursor-pointer text-white rounded-xl transition-all duration-200 font-semibold shadow-md hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
                            >
                                {loading ? <Loader className='animate-spin' /> : <p>Start Session</p>}
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center space-x-8">
                                <div className="flex items-center bg-purple-100 rounded-lg px-4 py-2">
                                    <User className="mr-3 text-purple-600 w-5 h-5" />
                                    <span className="font-medium text-gray-800">{candidateName}</span>
                                </div>
                                <div className="flex items-center bg-green-100 rounded-lg px-4 py-2">
                                    <Clock className="mr-3 text-green-600 w-5 h-5" />
                                    <span className="text-gray-800 font-mono">{formatTime(sessionTime)}</span>
                                </div>
                                <div className="flex items-center bg-blue-100 rounded-lg px-4 py-2">
                                    <Activity className="mr-3 text-blue-600 w-5 h-5" />
                                    <span className={`font-bold ${getScoreColor(integrityScore)}`}>
                                        Score: {integrityScore}/100
                                    </span>
                                </div>
                            </div>
                            <div className="flex space-x-3">
                                <button
                                    onClick={endSession}
                                    className="cursor-pointer px-6 py-3 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-lg hover:from-pink-600 hover:to-rose-600 transition-all duration-200 font-semibold shadow-md hover:shadow-pink-500/25 transform hover:scale-105"
                                >
                                    {loading ? <Loader className='animate-spin' /> : <p>End Session</p>}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Video Feed */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white/90 backdrop-blur-xl border border-purple-200/50 rounded-2xl shadow-lg p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-2xl font-semibold text-gray-800 flex items-center">
                                    <Camera className="mr-3 text-[#800080] w-6 h-6" />
                                    Live Video Feed
                                </h2>
                                <div className="flex items-center">
                                    <div className={`w-3 h-3 rounded-full mr-2 ${isSessionActive ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`}></div>
                                    <span className="text-sm text-gray-600">
                                        {isSessionActive ? 'RECORDING' : 'OFFLINE'}
                                    </span>
                                </div>
                            </div>
                            <div className="relative">
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    muted
                                    className="w-full h-96 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl object-cover border border-purple-200/50 shadow-inner"
                                />
                                <canvas ref={canvasRef} className="hidden" />
                                {!isSessionActive && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-sm rounded-xl">
                                        <div className="text-center">
                                            <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                            <span className="text-gray-600 text-lg font-medium">Session Not Active</span>
                                            <p className="text-gray-500 text-sm mt-2">Start a session to begin monitoring</p>
                                        </div>
                                    </div>
                                )}
                                {isSessionActive && (
                                    <div className="absolute top-4 left-4 bg-red-500/90 backdrop-blur-sm text-white px-3 py-1 rounded-full text-sm font-semibold shadow-md">
                                        ● LIVE
                                    </div>
                                )}
                            </div>
                        </div>
                        <OldReports  setShowReport={setShowReport} downloadPDF={downloadPDF} sessionReport={sessionReport} setSessionReport={setSessionReport}/>

                        {/* Report Modal */}
                        <ReportModal showReport={showReport} sessionReport={sessionReport} setShowReport={setShowReport} getScoreColor={getScoreColor} getAlertTypeColor={getAlertTypeColor} getAlertTypeIcon={getAlertTypeIcon} downloadPDF={downloadPDF} />

                    </div>

                    {/* Stats and Alerts */}
                    <div className="space-y-8">
                        {/* Statistics */}
                        <div className="bg-white/90 backdrop-blur-xl border border-purple-200/50 rounded-2xl shadow-lg p-6">
                            <h3 className="text-xl font-semibold text-gray-800 mb-6 flex items-center">
                                <Activity className="mr-3 text-green-600 w-6 h-6" />
                                Analytics
                            </h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg border border-amber-200/50">
                                    <span className="text-gray-700 flex items-center">
                                        <Eye className="w-4 h-4 mr-2" />
                                        Looking Away:
                                    </span>
                                    <span className="font-bold text-amber-600 bg-amber-100 px-3 py-1 rounded-full text-sm">
                                        {stats.looking_away_frames}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-200/50">
                                    <span className="text-gray-700 flex items-center">
                                        <Smartphone className="w-4 h-4 mr-2" />
                                        Mobile Detected:
                                    </span>
                                    <span className="font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full text-sm">
                                        {stats.mobile_detected_frames}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200/50">
                                    <span className="text-gray-700 flex items-center">
                                        <Users className="w-4 h-4 mr-2" />
                                        Multiple People:
                                    </span>
                                    <span className="font-bold text-orange-600 bg-orange-100 px-3 py-1 rounded-full text-sm">
                                        {stats.multiple_people_frames}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200/50">
                                    <span className="text-gray-700">No Face:</span>
                                    <span className="font-bold text-gray-600 bg-gray-100 px-3 py-1 rounded-full text-sm">
                                        {stats.no_face_frames}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Recent Alerts */}
                        <div className="bg-white/90 backdrop-blur-xl border border-purple-200/50 rounded-2xl shadow-lg p-6">
                            <h3 className="text-xl font-semibold text-gray-800 mb-6 flex items-center">
                                <AlertTriangle className="mr-3 text-yellow-500 w-6 h-6" />
                                Recent Alerts
                            </h3>
                            <div className="space-y-3 max-h-80 overflow-y-auto custom-scrollbar">
                                {alerts.length === 0 ? (
                                    <div className="text-center py-8">
                                        <Shield className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                                        <p className="text-gray-500">No alerts detected</p>
                                        <p className="text-gray-400 text-sm mt-1">System is monitoring...</p>
                                    </div>
                                ) : (
                                    alerts.slice(-5).reverse().map((alert, index) => (
                                        <div key={index} className={`border rounded-xl p-4 backdrop-blur-sm transition-all ${getAlertTypeColor(alert.type)}`}>
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-start space-x-3">
                                                    <div className="mt-0.5">
                                                        {getAlertTypeIcon(alert.type)}
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold block">{alert.type}</span>
                                                        <p className="text-sm opacity-90 mt-1">{alert.details}</p>
                                                    </div>
                                                </div>
                                                <span className="text-xs opacity-75 font-mono">
                                                    {new Date(alert.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <ToastContainer />
        </div>
    );
};

export default VideoProctoring;