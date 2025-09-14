"use client";
import React, { useState, useEffect } from "react";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
import Image from "next/image";
import axios from "axios";
import { toast } from 'react-toastify';
import Card from "./Card";
import { Loader2, Eye, Download, Camera, FileText } from "lucide-react";

library.add(faTrash);

const OldReports = ({ setShowReport, downloadPDF, sessionReport, setSessionReport }) => {
    const [data, setData] = useState([]);
    const [isMobile, setIsMobile] = useState(false);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
    });

    function formatDate(dateString) {
        const date = new Date(dateString);
        const pad = (num) => num.toString().padStart(2, "0");
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    function formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            return `${remainingSeconds}s`;
        }
    }

    function getScoreColor(score) {
        if (score >= 80) return 'text-green-600';
        if (score >= 60) return 'text-yellow-600';
        return 'text-red-600';
    }

    function getStatusColor(status) {
        switch (status.toLowerCase()) {
            case 'completed':
                return 'bg-green-200 text-green-800';
            case 'active':
                return 'bg-blue-200 text-blue-800';
            default:
                return 'bg-gray-200 text-gray-800';
        }
    }

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 768px)");

        const handleMediaQueryChange = (event) => {
            setIsMobile(event.matches);
        };

        setIsMobile(mediaQuery.matches);
        mediaQuery.addEventListener("change", handleMediaQueryChange);

        return () => {
            mediaQuery.removeEventListener("change", handleMediaQueryChange);
        };
    }, []);

    useEffect(() => {
        fetchReports();
    }, [sessionReport, pagination.page  ]);

    const fetchReports = async () => {
        try {
            setLoading(true);
            const skip = (pagination.page - 1) * pagination.limit;
            const response = await axios.get(
                `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/reports?limit=${pagination.limit}&skip=${skip}`
            );
            
            if (response.data.reports) {
                const transformedData = response.data.reports.map((doc, index) => ({
                    mongoID: doc._id,
                    id: skip + index + 1,
                    name: doc.candidate_name,
                    examName: doc.exam_name,
                    sessionId: doc.session_id,
                    status: doc.status,
                    created: formatDate(doc.created_at || doc.start_time),
                    integrityScore: doc.integrity_score,
                    duration: doc.duration_seconds,
                    totalAlerts: doc.alert_summary?.total_alerts || 0,
                    reportData: doc // Store full report data for viewing
                }));
                
                setData(transformedData);
                setPagination(prev => ({
                    ...prev,
                    total: response.data.pagination.total,
                    totalPages: response.data.pagination.total_pages
                }));
            }
            setLoading(false);
        } catch (error) {
            setLoading(false);
            console.error("Error getting reports", error);
            const axiosError = error;
            let errorMessage = axiosError.response?.data?.detail || "Failed to fetch reports";
            toast.error(errorMessage);
        }
    };

    const transformReportForModal = (reportData) => {
        // Transform the database report to match the expected format for ReportModal
        const suspiciousEvents = {};
        if (reportData.alert_summary?.alert_types) {
            Object.entries(reportData.alert_summary.alert_types).forEach(([key, value]) => {
                suspiciousEvents[key] = value;
            });
        }

        return {
            candidateName: reportData.candidate_name,
            sessionId: reportData.session_id,
            examName: reportData.exam_name,
            sessionDate: new Date(reportData.start_time).toLocaleDateString(),
            sessionTime: new Date(reportData.start_time).toLocaleTimeString(),
            duration: formatDuration(reportData.duration_seconds),
            durationSeconds: reportData.duration_seconds,
            totalFrames: reportData.stats?.total_frames_captured || 0,
            integrityScore: reportData.integrity_score,
            suspiciousEvents,
            detailedStats: {
                focusLost: reportData.stats?.looking_away_frames || 0,
                mobileDetected: reportData.stats?.mobile_detected_frames || 0,
                multiplePeople: reportData.stats?.multiple_people_frames || 0,
                noFaceDetected: reportData.stats?.no_face_frames || 0
            },
            alertLog: (reportData.alerts || []).map(alert => ({
                ...alert,
                timestamp: new Date(alert.timestamp).toLocaleTimeString()
            })),
            recommendations: generateRecommendations(reportData.integrity_score)
        };
    };

    const generateRecommendations = (score) => {
        const recommendations = [];
        
        if (score < 60) {
            recommendations.push("Review exam guidelines and ensure proper supervision");
            recommendations.push("Consider additional verification methods");
        } else if (score < 80) {
            recommendations.push("Monitor candidate behavior more closely in future exams");
            recommendations.push("Provide additional guidance on exam protocols");
        } else {
            recommendations.push("Excellent compliance with exam protocols");
            recommendations.push("Candidate demonstrated good exam behavior");
        }
        
        return recommendations;
    };

    const handleView = async (reportData) => {
        try {
            // If we only have partial data, fetch the full report
            let fullReportData = reportData;
            if (!reportData.detection_report) {
                const response = await axios.get(
                    `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/reports/${reportData.mongoID}`
                );
                fullReportData = response.data.report;
            }

            const transformedReport = transformReportForModal(fullReportData);
            setSessionReport(transformedReport);
            setShowReport(true);
        } catch (error) {
            console.error("Error fetching full report", error);
            toast.error("Failed to load report details");
        }
    };

    const handleDownload = async (reportData) => {
        try {
            const transformedReport = transformReportForModal(reportData);
            if (downloadPDF) {
                await downloadPDF(transformedReport);
            } else {
                toast.info("PDF download function not available");
            }
        } catch (error) {
            console.error("Error downloading report", error);
            toast.error("Failed to download report");
        }
    };

    const handleDelete = async (mongoID) => {
        // Optimistically update UI
        setData(data.filter((item) => item.mongoID !== mongoID));
        
        try {
            await axios.delete(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/reports/${mongoID}`);
            toast.success("Report deleted successfully");
            // Refresh the list to get updated pagination
            fetchReports();
        } catch (error) {
            console.log("Error deleting report", error);
            // Revert optimistic update on error
            fetchReports();
            const axiosError = error;
            let errorMessage = axiosError.response?.data?.detail || "Failed to delete report";
            toast.error(errorMessage);
        }
    };

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= pagination.totalPages) {
            setPagination(prev => ({ ...prev, page: newPage }));
        }
    };

    return (
        <div className="overflow-hidden bg-white/90 backdrop-blur-xl border border-purple-200/50 rounded-2xl shadow-lg p-6 flex flex-col justify-center items-center">
            <h2 className="text-2xl font-semibold text-gray-800 flex items-center mb-4 w-full">
                <FileText className="mr-3 text-[#800080] w-6 h-6" />
                Proctoring Reports
            </h2>
            
            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin w-8 h-8 text-[#800080]" />
                    <span className="ml-2 text-gray-600">Loading reports...</span>
                </div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <p>No reports found</p>
                </div>
            ) : isMobile ? (
                <div className="flex flex-col justify-center items-center gap-3 w-full">
                    {data.map((item) => (
                        <div key={item.mongoID}>
                            <Card
                                ID={item.id}
                                MONGOID={item.mongoID}
                                NAME={`${item.name} - ${item.examName || 'Exam'}`}
                                CREATED_AT={item.created}
                                STATUS={item.status}
                                INTEGRITY_SCORE={item.integrityScore}
                                DURATION={formatDuration(item.duration)}
                                ALERTS={item.totalAlerts}
                                handleDownload={() => handleDownload(item.reportData)}
                                handleView={() => handleView(item.reportData)}
                                handleDelete={handleDelete}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="w-full">
                    <table className="w-full whitespace-no-wrap overflow-hidden table-striped">
                        <thead>
                            <tr>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    ID
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Candidate
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Created At
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Duration
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Integrity Score
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Status
                                </th>
                                <th className="px-3 py-3 text-gray-500 font-bold tracking-wider uppercase text-xs">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((item) => (
                                <tr key={item.mongoID}>
                                    <td className="border-t px-4 py-2">
                                        <span className="text-gray-600 px-1 py-4 flex items-center">
                                            {item.id}
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2 ">
                                        <span className="text-gray-600 px-2 py-4 flex gap-3 items-center">
                                            {item.name}
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2 w-full">
                                        <span className="text-gray-600  px-2 py-4">
                                            {item.created}
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2">
                                        <span className="text-gray-600 px-2 py-4">
                                            {formatDuration(item.duration)}
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2">
                                        <span className={`px-2 py-4 font-semibold ${getScoreColor(item.integrityScore)}`}>
                                            {item.integrityScore}%
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2 text-sm">
                                        <span className={`p-2 rounded-full ${getStatusColor(item.status)}`}>
                                            {item.status}
                                        </span>
                                    </td>
                                    <td className="border-t px-4 py-2">
                                        <div className="flex justify-center items-center gap-5">
                                            <div 
                                                onClick={() => handleView(item.reportData)}
                                                title="View Report"
                                            >
                                                <Eye className="cursor-pointer text-gray-400 hover:text-purple-600 transition-colors" />
                                            </div>
                                            <div 
                                                onClick={() => handleDownload(item.reportData)}
                                                title="Download PDF"
                                            >
                                                <Download className="cursor-pointer text-gray-400 hover:text-purple-600 transition-colors" />
                                            </div>
                                            <FontAwesomeIcon
                                                icon={faTrash}
                                                className="cursor-pointer text-gray-400 hover:text-red-600 transition-colors"
                                                title="Delete Report"
                                                onClick={() => handleDelete(item.mongoID)}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {!loading && data.length > 0 && (
                <div className="flex items-center justify-between w-full mt-6 pt-4 border-t border-gray-200">
                    <div className="text-sm text-gray-500">
                        Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                        {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                        {pagination.total} results
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => handlePageChange(pagination.page - 1)}
                            disabled={pagination.page === 1}
                            className="px-3 py-1 text-sm text-gray-400 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        <span className="px-3 py-1 text-sm text-gray-400">
                            Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <button
                            onClick={() => handlePageChange(pagination.page + 1)}
                            disabled={pagination.page === pagination.totalPages}
                            className="px-3 py-1 text-sm border text-gray-400 border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OldReports;