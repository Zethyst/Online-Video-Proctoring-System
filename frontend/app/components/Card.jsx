"use client";
import React from "react";
import { Eye, Download } from "lucide-react";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
library.add(faTrash);

function Card({
  ID,
  MONGOID,
  NAME,
  CREATED_AT,
  STATUS,
  INTEGRITY_SCORE,
  DURATION,
  ALERTS,
  handleDownload,
  handleView,
  handleDelete,
}) {
  
  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-200 text-green-800';
      case 'active':
        return 'bg-blue-200 text-blue-800';
      default:
        return 'bg-gray-200 text-gray-800';
    }
  };

  return (
    <div className="p-4 flex flex-col justify-center items-start gap-3 w-full custom-border bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center w-full">
        <p className="text-gray-600 flex items-center">
          <span className="text-gray-500 font-bold tracking-wider uppercase text-xs pr-2">
            ID:
          </span>
          #{ID}
        </p>
        <div className={`px-2 py-1 rounded-full text-xs font-semibold ${getScoreColor(INTEGRITY_SCORE)}`}>
          {INTEGRITY_SCORE}% Integrity
        </div>
      </div>

      <p className="text-gray-600 flex items-center leading-5">
        <span className="text-gray-500 font-bold tracking-wider uppercase text-xs pr-2">
          Candidate:
        </span>
        <span className="font-medium">{NAME}</span>
      </p>

      <div className="flex justify-between items-center w-full">
        <p className="text-gray-600 flex items-center">
          <span className="text-gray-500 font-bold tracking-wider uppercase text-xs pr-2">
            Date:
          </span>
          {CREATED_AT}
        </p>
        <p className="text-gray-600 flex items-center">
          <span className="text-gray-500 font-bold tracking-wider uppercase text-xs pr-2">
            Duration:
          </span>
          {DURATION}
        </p>
      </div>

      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 font-bold tracking-wider uppercase text-xs">
            Status:
          </span>
          <span className={`pill text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(STATUS)}`}>
            {STATUS}
          </span>
        </div>
        <div className="text-right">
          <span className="text-gray-500 font-bold tracking-wider uppercase text-xs">
            Alerts:
          </span>
          <span className={`ml-1 font-medium ${ALERTS > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {ALERTS}
          </span>
        </div>
      </div>

      <div className="w-full border-t border-gray-100 pt-3">
        <div className="flex justify-center items-center gap-6">
          <div 
            onClick={handleView}
            className="flex flex-col items-center cursor-pointer hover:text-purple-600 transition-colors group"
          >
            <div className="p-2 rounded-full text-gray-400  group-hover:bg-purple-50 transition-colors">
              <Eye size={18} />
            </div>
            <span className="text-xs mt-1 text-gray-400 ">View</span>
          </div>
          
          <div 
            onClick={handleDownload}
            className="flex flex-col items-center cursor-pointer text-gray-400  hover:text-purple-600 transition-colors group"
          >
            <div className="p-2 rounded-full group-hover:bg-purple-50 transition-colors">
              <Download size={18} />
            </div>
            <span className="text-xs mt-1">Download</span>
          </div>
          
          <div 
            onClick={() => handleDelete(MONGOID)}
            className="flex flex-col items-center cursor-pointer text-gray-400  hover:text-red-600 transition-colors group"
          >
            <div className="p-2 rounded-full group-hover:bg-red-50 transition-colors">
              <FontAwesomeIcon icon={faTrash} size="sm" />
            </div>
            <span className="text-xs mt-1">Delete</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Card;