"use client"
import React from 'react'
import {
    Camera, User, Clock, Activity, AlertTriangle, Shield, Eye, Users, Smartphone,
    FileText, Download, X, CheckCircle, XCircle, AlertOctagon, Phone, BookOpen,
    Calendar, Timer, TrendingDown, Award, Loader2,
    Loader
} from 'lucide-react';

function ReportModal({ showReport, sessionReport, setShowReport, getScoreColor, getAlertTypeColor, getAlertTypeIcon, downloadPDF }) {
    return (
        <div>{showReport && sessionReport && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl border border-purple-200/50 shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
                    <div className="flex items-center justify-between p-6 border-b border-purple-200/50">
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                            <FileText className="mr-3 text-purple-600 w-6 h-6" />
                            Proctoring Report
                        </h2>
                        <button
                            onClick={() => setShowReport(false)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X className="w-6 h-6 text-gray-600" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
                        {/* Report Header */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            <div className="bg-purple-50 rounded-xl p-6 border border-purple-200/50">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                                    <User className="mr-2 text-purple-600 w-5 h-5" />
                                    Candidate Information
                                </h3>
                                <div className="space-y-3 text-gray-700">
                                    <div className="flex justify-between">
                                        <span>Name:</span>
                                        <span className="font-medium text-gray-800">{sessionReport.candidateName}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Session ID:</span>
                                        <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                            {sessionReport.sessionId}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Date:</span>
                                        <span className="text-gray-800">{sessionReport.sessionDate}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Duration:</span>
                                        <span className="text-gray-800 font-mono">{sessionReport.duration}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-green-50 rounded-xl p-6 border border-green-200/50">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                                    <Award className="mr-2 text-green-600 w-5 h-5" />
                                    Final Score
                                </h3>
                                <div className="text-center">
                                    <div className={`text-6xl font-bold mb-2 ${getScoreColor(sessionReport.integrityScore)}`}>
                                        {sessionReport.integrityScore}
                                    </div>
                                    <div className="text-gray-600 text-lg">out of 100</div>
                                    <div className={`mt-4 px-4 py-2 rounded-full text-sm font-medium ${sessionReport.integrityScore >= 80
                                        ? 'bg-green-100 text-green-700 border border-green-200'
                                        : sessionReport.integrityScore >= 60
                                            ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                                            : 'bg-red-100 text-red-700 border border-red-200'
                                        }`}>
                                        {sessionReport.integrityScore >= 80 ? 'Excellent Performance' :
                                            sessionReport.integrityScore >= 60 ? 'Good Performance' : 'Requires Review'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Statistics Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <div className="bg-amber-50 rounded-lg p-4 border border-amber-200/50 text-center">
                                <Eye className="w-8 h-8 text-amber-600 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-gray-800">{sessionReport.detailedStats.focusLost}</div>
                                <div className="text-gray-600 text-sm">Looking Away</div>
                            </div>
                            <div className="bg-red-50 rounded-lg p-4 border border-red-200/50 text-center">
                                <Smartphone className="w-8 h-8 text-red-600 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-gray-800">{sessionReport.detailedStats.mobileDetected}</div>
                                <div className="text-gray-600 text-sm">Mobile Detected</div>
                            </div>
                            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200/50 text-center">
                                <Users className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-gray-800">{sessionReport.detailedStats.multiplePeople}</div>
                                <div className="text-gray-600 text-sm">Multiple People</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200/50 text-center">
                                <AlertOctagon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-gray-800">{sessionReport.detailedStats.noFaceDetected}</div>
                                <div className="text-gray-600 text-sm">No Face</div>
                            </div>
                        </div>

                        {/* Score Deductions */}
                        {sessionReport?.deductions?.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                                    <TrendingDown className="mr-2 text-red-600 w-5 h-5" />
                                    Score Deductions
                                </h3>
                                <div className="space-y-3">
                                    {sessionReport.deductions.map((deduction, index) => (
                                        <div key={index} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <span className="font-medium text-gray-800">{deduction.reason}</span>
                                                    <p className="text-gray-600 text-sm">
                                                        Occurred in {deduction.percentage}% of session
                                                    </p>
                                                </div>
                                                <span className="text-2xl font-bold text-red-600">
                                                    -{deduction.deduction}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Alert Log */}
                        {sessionReport.alertLog.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                                    <AlertTriangle className="mr-2 text-yellow-500 w-5 h-5" />
                                    Alert Timeline
                                </h3>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-2">
                                    {sessionReport.alertLog.slice(0, 20).map((alert, index) => (
                                        <div key={index} className={`border rounded-lg p-3 ${getAlertTypeColor(alert.type)}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-3">
                                                    {getAlertTypeIcon(alert.type)}
                                                    <div>
                                                        <span className="font-medium">{alert.type}</span>
                                                        <p className="text-sm opacity-90">{alert.details}</p>
                                                    </div>
                                                </div>
                                                <span className="text-xs opacity-75 font-mono">
                                                    {alert.timestamp}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {sessionReport.alertLog.length > 20 && (
                                        <p className="text-gray-600 text-center py-2 text-sm">
                                            ... and {sessionReport.alertLog.length - 20} more alerts
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Recommendations */}
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                                <BookOpen className="mr-2 text-blue-600 w-5 h-5" />
                                Recommendations
                            </h3>
                            <div className="space-y-3">
                                {sessionReport.recommendations.map((rec, index) => (
                                    <div key={index} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <p className="text-gray-700">{rec}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="flex justify-end space-x-4 px-6 pb-6 pt-2 border-t border-purple-200/50">
                        <button
                            onClick={() => setShowReport(false)}
                            className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors cursor-pointer"
                        >
                            Close
                        </button>
                        <button
                            onClick={downloadPDF}
                            className="px-6 py-2 bg-gradient-to-r from-[#aa00aa] to-[#5a005a] text-white rounded-lg hover:from-[#840184] hover:to-[#360036] cursor-pointer transition-all duration-200 font-semibold shadow-md hover:shadow-purple-500/25 flex items-center"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                        </button>
                    </div>
                </div>
            </div>
        )}</div>
    )
}

export default ReportModal