import React, { useEffect, useState } from "react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import { Calendar as CalendarIcon, Camera, ChevronRight, MessageSquare, Plus } from "lucide-react";

import JobFormModal from "../components/shared/JobFormModal";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { Client, Job } from "../types";

export default function CalendarPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, clientsRes] = await Promise.all([
        authFetch('/api/jobs'),
        authFetch('/api/clients'),
      ]);
      setJobs(await jobsRes.json());
      setClients(await clientsRes.json());
    } catch (error) {
      console.error('Erro ao carregar agenda:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <CalendarView jobs={jobs} clients={clients} onUpdate={fetchData} />;
}

// --- Calendar Component ---
function CalendarView({ jobs, clients, onUpdate }: { jobs: Job[], clients: Client[], onUpdate: () => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('month');
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [showJobModal, setShowJobModal] = useState(false);
  const [draggedJob, setDraggedJob] = useState<Job | null>(null);

  const next = () => {
    if (view === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const prev = () => {
    if (view === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(subDays(currentDate, 7));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const handleJobClick = (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingJob(job);
    setSelectedDate(undefined);
    setShowJobModal(true);
  };

  const handleDayClick = (date: Date) => {
    setEditingJob(null);
    setSelectedDate(format(date, 'yyyy-MM-dd'));
    setShowJobModal(true);
  };

  const handleDragStart = (e: React.DragEvent, job: Job) => {
    setDraggedJob(job);
    e.dataTransfer.setData('jobId', job.id.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    if (!draggedJob) return;

    const newDate = format(date, 'yyyy-MM-dd');
    if (draggedJob.job_date === newDate) return;

    try {
      await authFetch(`/api/jobs/${draggedJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draggedJob,
          job_date: newDate
        })
      });
      onUpdate();
    } catch (error) {
      console.error('Erro ao reagendar:', error);
    } finally {
      setDraggedJob(null);
    }
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
            <div key={day} className="px-4 py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: monthStart.getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="h-32 border-b border-r border-gray-50 bg-gray-50/30" />
          ))}
          
          {days.map(day => {
            const dayJobs = jobs.filter(j => {
              const jobDate = parseDate(j.job_date);
              return jobDate && isSameDay(jobDate, day);
            });
            return (
              <div 
                key={day.toString()} 
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, day)}
                onClick={() => handleDayClick(day)}
                className="h-32 border-b border-r border-gray-50 p-2 hover:bg-gray-50 transition-colors cursor-pointer group/day"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={cn(
                    "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full",
                    isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-gray-400 group-hover/day:text-indigo-600"
                  )}>
                    {format(day, 'd')}
                  </div>
                  <Plus size={14} className="text-gray-300 opacity-0 group-hover/day:opacity-100 transition-opacity" />
                </div>
                <div className="space-y-1 overflow-y-auto max-h-20 scrollbar-hide">
                  {dayJobs.map(job => (
                    <button 
                      key={job.id} 
                      draggable
                      onDragStart={(e) => handleDragStart(e, job)}
                      onClick={(e) => handleJobClick(job, e)}
                      className="w-full text-left text-[10px] p-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-100 truncate font-medium flex items-center gap-1 hover:bg-indigo-100 transition-colors cursor-move"
                    >
                      {job.google_event_id && <CalendarIcon size={10} className="text-indigo-400 shrink-0" />}
                      {job.job_time && (
                        <span className="font-bold shrink-0">
                          {job.job_time}{job.job_end_time ? `-${job.job_end_time}` : ''}
                        </span>
                      )}
                      <span className="truncate">
                        {job.client_name ? `${job.client_name} - ${job.job_type}` : (job.job_name || job.job_type)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

    return (
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
        {days.map(day => {
          const dayJobs = jobs.filter(j => {
            const jobDate = parseDate(j.job_date);
            return jobDate && isSameDay(jobDate, day);
          });
          return (
            <div 
              key={day.toString()} 
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, day)}
              onClick={() => handleDayClick(day)}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-[400px] cursor-pointer group/day"
            >
              <div className={cn(
                "p-4 border-b border-gray-50 text-center relative",
                isSameDay(day, new Date()) ? "bg-indigo-50" : "bg-gray-50/50"
              )}>
                <Plus size={16} className="absolute top-4 right-4 text-gray-300 opacity-0 group-hover/day:opacity-100 transition-opacity" />
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                  {format(day, 'EEE', { locale: ptBR })}
                </div>
                <div className={cn(
                  "text-xl font-bold inline-flex items-center justify-center w-10 h-10 rounded-full",
                  isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-gray-700"
                )}>
                  {format(day, 'd')}
                </div>
              </div>
              <div className="flex-1 p-3 space-y-3 overflow-y-auto">
                {dayJobs.sort((a, b) => (a.job_time || '').localeCompare(b.job_time || '')).map(job => (
                  <button 
                    key={job.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, job)}
                    onClick={(e) => handleJobClick(job, e)}
                    className="w-full text-left p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-indigo-200 hover:shadow-md transition-all group cursor-move"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase">
                        {job.job_time || '00:00'}{job.job_end_time ? ` - ${job.job_end_time}` : ''}
                      </span>
                      {job.google_event_id && <CalendarIcon size={12} className="text-indigo-400" />}
                    </div>
                    <div className="font-bold text-gray-900 text-sm mb-1 group-hover:text-indigo-600 transition-colors">
                      {job.client_name || job.job_name || 'Tarefa'}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Camera size={12} />
                      {job.job_type}
                    </div>
                  </button>
                ))}
                {dayJobs.length === 0 && (
                  <div className="h-full flex items-center justify-center text-gray-300 italic text-xs text-center px-4">
                    Nenhum compromisso
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const dayJobs = jobs.filter(j => {
      const jobDate = parseDate(j.job_date);
      return jobDate && isSameDay(jobDate, currentDate);
    });

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold text-indigo-600">
              {format(currentDate, 'd')}
            </div>
            <div>
              <div className="text-lg font-bold text-gray-800 capitalize">
                {format(currentDate, 'EEEE', { locale: ptBR })}
              </div>
              <div className="text-gray-500">
                {format(currentDate, 'MMMM yyyy', { locale: ptBR })}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-gray-400 uppercase tracking-widest">Compromissos</div>
            <div className="text-2xl font-bold text-gray-900">{dayJobs.length}</div>
          </div>
        </div>

        <div className="space-y-3">
          {dayJobs.sort((a, b) => (a.job_time || '').localeCompare(b.job_time || '')).map(job => (
            <button 
              key={job.id}
              onClick={(e) => handleJobClick(job, e)}
              className="w-full text-left p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-indigo-200 hover:shadow-md transition-all flex items-center gap-6 group"
            >
              <div className="w-24 text-center border-r border-gray-100 pr-6">
                <div className="text-xl font-bold text-gray-900">{job.job_time || '00:00'}</div>
                {job.job_end_time && <div className="text-xs text-gray-400">até {job.job_end_time}</div>}
                <div className="text-[10px] font-bold text-gray-400 uppercase mt-1">Horário</div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-lg font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">
                    {job.client_name || job.job_name || 'Tarefa'}
                  </h4>
                  {job.google_event_id && <CalendarIcon size={16} className="text-indigo-400" />}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <Camera size={16} className="text-gray-400" />
                    {job.job_type}
                  </div>
                  {job.notes && (
                    <div className="flex items-center gap-1.5 truncate max-w-xs">
                      <MessageSquare size={16} className="text-gray-400" />
                      <span className="truncate">{job.notes}</span>
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-indigo-600 transition-colors" />
            </button>
          ))}
          {dayJobs.length === 0 && (
            <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-12 text-center">
              <CalendarIcon size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">Nenhum compromisso agendado para este dia.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Agenda</h3>
          <p className="text-gray-500">Controle seus ensaios e compromissos.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={() => { setEditingJob(null); setSelectedDate(undefined); setShowJobModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all"
          >
            <Plus size={20} />
            Novo Compromisso
          </button>

          <div className="flex bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
            <button 
              onClick={() => setView('day')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'day' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Dia
            </button>
            <button 
              onClick={() => setView('week')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'week' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Semana
            </button>
            <button 
              onClick={() => setView('month')}
              className={cn(
                "px-4 py-1.5 text-sm font-bold rounded-lg transition-all",
                view === 'month' ? "bg-indigo-600 text-white shadow-md" : "text-gray-400 hover:text-gray-600"
              )}
            >
              Mês
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
            <button onClick={prev} className="p-2 hover:bg-gray-50 rounded-lg text-gray-600">
              <ChevronRight className="rotate-180" size={20} />
            </button>
            <span className="font-bold text-gray-700 min-w-32 text-center capitalize text-sm">
              {view === 'day' ? format(currentDate, "dd 'de' MMMM", { locale: ptBR }) :
               view === 'week' ? `Semana de ${format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'dd/MM')}` :
               format(currentDate, 'MMMM yyyy', { locale: ptBR })}
            </span>
            <button onClick={next} className="p-2 hover:bg-gray-50 rounded-lg text-gray-600">
              <ChevronRight size={20} />
            </button>
          </div>
          
          <button 
            onClick={() => setCurrentDate(new Date())}
            className="px-4 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold text-indigo-600 hover:bg-gray-50 shadow-sm transition-all"
          >
            Hoje
          </button>
        </div>
      </div>

      <motion.div
        key={view + currentDate.toISOString()}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        {view === 'month' && renderMonthView()}
        {view === 'week' && renderWeekView()}
        {view === 'day' && renderDayView()}
      </motion.div>

      {showJobModal && (
        <JobFormModal 
          clients={clients}
          job={editingJob}
          initialDate={selectedDate}
          onClose={() => { setShowJobModal(false); setEditingJob(null); setSelectedDate(undefined); }}
          onSave={() => { setShowJobModal(false); setEditingJob(null); setSelectedDate(undefined); onUpdate(); }}
        />
      )}
    </div>
  );
}
