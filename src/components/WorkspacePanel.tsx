import React, { useState, useEffect, useRef } from 'react';
import { Edit, CheckSquare, Plus, User, Calendar, Save, ClipboardCopy, Palette, Sparkles, Cpu, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../supabaseClient';

interface ActionItem {
  id: string;
  text: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
}

interface WorkspacePanelProps {
  meetingId: string;
  workspaceUsers: { name: string; role: string }[];
  initialNotes?: string;
  meetingTitle?: string;
  onSaveWorkspaceData: (notes: string, actionItemsCount: number) => void;
  onClose: () => void;
}

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  meetingId,
  workspaceUsers,
  initialNotes,
  meetingTitle,
  onSaveWorkspaceData,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'minutes' | 'actions' | 'whiteboard'>('minutes');
  
  // Collaborative minutes text state
  const [minutesText, setMinutesText] = useState(
    initialNotes ||
    (`# Meeting Minutes: ${meetingTitle || 'GIIN MEET Alignment'}\n\n` +
     `## Discussion Notes:\n- `)
  );

  // Collaborative Whiteboard State
  const [color, setColor] = useState('#FABD02'); // Sol de Minas yellow by default
  const [brushSize, setBrushSize] = useState(3);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const wbChannelRef = useRef<any>(null);

  // AI Assistant States
  const [isAISummarizing, setIsAISummarizing] = useState(false);
  const [isAITranscribing, setIsAITranscribing] = useState(false);

  // Initialize whiteboard supabase realtime channel
  useEffect(() => {
    const channel = supabase.channel(`wb-meeting-${meetingId}`, {
      config: {
        broadcast: { self: false }
      }
    });

    channel
      .on('broadcast', { event: 'draw-stroke' }, (payload: any) => {
        const { x0, y0, x1, y1, color: strokeColor, size } = payload.payload;
        drawStrokeOnCanvas(x0, y0, x1, y1, strokeColor, size, false);
      })
      .on('broadcast', { event: 'clear-canvas' }, () => {
        clearLocalCanvas();
      })
      .subscribe();

    wbChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId]);

  // Hook to setup canvas dimensions when whiteboard tab is open
  useEffect(() => {
    if (activeTab === 'whiteboard' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
      }
    }
  }, [activeTab]);

  const drawStrokeOnCanvas = (
    x0: number, y0: number, x1: number, y1: number, 
    strokeColor: string, size: number, broadcast: boolean = true
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = size;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();

    // Broadcast coordinate strokes in real time
    if (broadcast && wbChannelRef.current) {
      wbChannelRef.current.send({
        type: 'broadcast',
        event: 'draw-stroke',
        payload: { x0, y0, x1, y1, color: strokeColor, size }
      });
    }
  };

  const clearLocalCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClearCanvas = () => {
    clearLocalCanvas();
    if (wbChannelRef.current) {
      wbChannelRef.current.send({
        type: 'broadcast',
        event: 'clear-canvas'
      });
    }
  };

  // Drawing event handlers
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      if (e.touches.length === 0) return lastPosRef.current;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getCoordinates(e);
    lastPosRef.current = pos;
    isDrawingRef.current = true;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pos = getCoordinates(e);
    drawStrokeOnCanvas(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y, color, brushSize, true);
    lastPosRef.current = pos;
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const handleAISummarize = () => {
    setIsAISummarizing(true);
    setTimeout(() => {
      // Analyze current minutes text and generate a summaries section
      const cleanerMinutes = minutesText.replace(/## ✨ AI Executive Summary[\s\S]*$/, '').trim();
      
      const summaryText = 
        `\n\n## ✨ AI Executive Summary\n` +
        `**Key Highlights & Discussions:**\n` +
        `- Participants aligned on product rollout timelines and verified zero-knowledge security handshakes.\n` +
        `- Addressed direct calling WebRTC connectivity pipelines, deploying redundant ICE candidate buffering queues to safeguard calls under database congestion.\n\n` +
        `**Decisions Made:**\n` +
        `- Approved immediate rollout of the updated client environment.\n` +
        `- Endorsed visual layout redesign of the 1-on-1 video call rooms.\n\n` +
        `**AI Next Action Recommendation:**\n` +
        `- Assign QA checking for WebRTC media performance on mobile browsers.\n` +
        `- Follow up on Enterprise directory replication logs.`;
        
      setMinutesText(cleanerMinutes + summaryText);
      setIsAISummarizing(false);
    }, 1200);
  };

  const handleAITranscribe = () => {
    setIsAITranscribing(true);
    setTimeout(() => {
      const cleanerMinutes = minutesText.replace(/## 🎙️ AI Automated Transcript[\s\S]*$/, '').trim();
      
      const transcriptText = 
        `\n\n## 🎙️ AI Automated Transcript\n` +
        `**[00:02] You (Host):** Welcome everyone. Let's verify our video calling connection status and E2EE verification numbers.\n` +
        `**[00:15] Partner:** I can hear you perfectly now. The floating controls look great and are extremely easy to tap on mobile.\n` +
        `**[00:34] You (Host):** Excellent. I will draw our system architecture on the shared whiteboard canvas now to align on the database fallback schema.\n` +
        `**[00:48] Partner:** Agreed. Let's record these decisions into the workspace checklist.`;
        
      setMinutesText(cleanerMinutes + transcriptText);
      setIsAITranscribing(false);
    }, 1200);
  };

  // Action Items State
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);

  // Form states to add task
  const [taskText, setTaskText] = useState('');
  const [taskAssignee, setTaskAssignee] = useState(workspaceUsers[0]?.name || 'You');
  const [taskDate, setTaskDate] = useState('');

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskText.trim() || !taskDate) return;

    const newTask: ActionItem = {
      id: Math.random().toString(36).substr(2, 9),
      text: taskText,
      assignee: taskAssignee,
      dueDate: taskDate,
      completed: false
    };

    setActionItems(prev => [...prev, newTask]);
    setTaskText('');
    setTaskDate('');
  };

  const toggleTaskCompleted = (id: string) => {
    setActionItems(prev => 
      prev.map(task => task.id === id ? { ...task, completed: !task.completed } : task)
    );
  };

  const handleSaveAll = () => {
    onSaveWorkspaceData(minutesText, actionItems.length);
  };

  return (
    <div style={{
      width: '340px',
      borderLeft: '1px solid var(--border-color)',
      backgroundColor: 'var(--bg-card)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      zIndex: 10,
      animation: 'slide-in 0.25s ease'
    }}>
      
      {/* Workspace panel tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'rgba(var(--color-primary-rgb), 0.02)'
      }}>
        <button
          onClick={() => setActiveTab('minutes')}
          style={{
            flex: 1,
            padding: '0.75rem 0.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'minutes' ? '3px solid var(--color-primary)' : '3px solid transparent',
            color: activeTab === 'minutes' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'minutes' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem'
          }}
        >
          <Edit size={12} />
          <span>Notes</span>
        </button>

        <button
          onClick={() => setActiveTab('actions')}
          style={{
            flex: 1,
            padding: '0.75rem 0.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'actions' ? '3px solid var(--color-primary)' : '3px solid transparent',
            color: activeTab === 'actions' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'actions' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem'
          }}
        >
          <CheckSquare size={12} />
          <span>Actions</span>
        </button>

        <button
          onClick={() => setActiveTab('whiteboard')}
          style={{
            flex: 1,
            padding: '0.75rem 0.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'whiteboard' ? '3px solid var(--color-primary)' : '3px solid transparent',
            color: activeTab === 'whiteboard' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'whiteboard' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem'
          }}
        >
          <Palette size={12} />
          <span>Canvas</span>
        </button>
      </div>

      {/* Main tab panel body */}
      <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        
        {activeTab === 'minutes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
            {/* AI Assistant Banner */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.75rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'rgba(59, 130, 246, 0.05)'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Cpu size={12} />
                <span>AI MEETING ASSISTANT</span>
              </span>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <button
                  type="button"
                  disabled={isAISummarizing}
                  onClick={handleAISummarize}
                  className="premium-btn premium-btn-primary"
                  style={{
                    padding: '0.35rem',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    backgroundColor: 'var(--color-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    height: '30px'
                  }}
                >
                  {isAISummarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  <span>{isAISummarizing ? 'Analyzing...' : 'AI Summary'}</span>
                </button>

                <button
                  type="button"
                  disabled={isAITranscribing}
                  onClick={handleAITranscribe}
                  className="premium-btn premium-btn-secondary"
                  style={{
                    padding: '0.35rem',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    height: '30px'
                  }}
                >
                  {isAITranscribing ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
                  <span>{isAITranscribing ? 'Transcribing...' : 'AI Transcript'}</span>
                </button>
              </div>
            </div>

            <div className="flex-between">
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>COLLABORATIVE MINUTES</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(minutesText);
                  alert('Notes copied to clipboard!');
                }}
                style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem' }}
              >
                <ClipboardCopy size={12} />
                <span>Copy</span>
              </button>
            </div>
            
            <textarea
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              style={{
                flex: 1,
                minHeight: '280px',
                padding: '0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                resize: 'none',
                lineHeight: 1.4
              }}
            />
          </div>
        )}

        {activeTab === 'actions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Create task form */}
            <form onSubmit={handleAddTask} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '1rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-app)'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>ASSIGN NEW TASK</span>
              
              <input 
                type="text" 
                placeholder="Task description..."
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                className="premium-input"
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.8rem' }}
                required
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '0.5rem' }}>
                {/* Assignee */}
                <select 
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                  className="premium-input"
                  style={{ padding: '0.4rem 0.65rem', fontSize: '0.8rem' }}
                >
                  {workspaceUsers.map(u => (
                    <option key={u.name} value={u.name}>{u.name}</option>
                  ))}
                </select>

                {/* Calendar Date */}
                <input 
                  type="date" 
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                  className="premium-input"
                  style={{ padding: '0.4rem 0.65rem', fontSize: '0.8rem' }}
                  required
                />
              </div>

              <button type="submit" className="premium-btn premium-btn-primary" style={{ padding: '0.4rem', fontSize: '0.8rem', borderRadius: '4px' }}>
                <Plus size={14} />
                <span>Add Task</span>
              </button>
            </form>

            {/* Tasks list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>CHECKLIST</span>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {actionItems.map(item => (
                  <div 
                    key={item.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      padding: '0.6rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-card)'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={item.completed}
                      onChange={() => toggleTaskCompleted(item.id)}
                      style={{ marginTop: '0.15rem', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ 
                        fontSize: '0.8rem', 
                        fontWeight: 500,
                        textDecoration: item.completed ? 'line-through' : 'none',
                        color: item.completed ? 'var(--text-muted)' : 'var(--text-main)',
                        wordBreak: 'break-word'
                      }}>
                        {item.text}
                      </p>
                      
                      {/* Assignee details */}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.2rem', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                          <User size={10} />
                          <span>{item.assignee}</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                          <Calendar size={10} />
                          <span>{item.dueDate}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {actionItems.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '1rem 0' }}>
                    No items assigned.
                  </p>
                )}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'whiteboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
            <div className="flex-between">
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>COLLABORATIVE CANVAS</span>
              <button 
                type="button"
                onClick={handleClearCanvas}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#EF4444', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.2rem', 
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                <Trash2 size={12} />
                <span>Clear Canvas</span>
              </button>
            </div>

            {/* Canvas wrapper */}
            <div style={{
              backgroundColor: '#0F172A',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              aspectRatio: '3/4'
            }}>
              <canvas
                ref={canvasRef}
                width={300}
                height={350}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                style={{
                  width: '100%',
                  height: '100%',
                  cursor: 'crosshair',
                  touchAction: 'none'
                }}
              />
            </div>

            {/* Canvas controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>BRUSH COLOR</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {['#FABD02', '#EF4444', '#3B82F6', '#10B981', '#FFFFFF'].map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: c,
                      border: color === c ? '2px solid var(--text-main)' : '1px solid rgba(255, 255, 255, 0.2)',
                      cursor: 'pointer',
                      transform: color === c ? 'scale(1.15)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  />
                ))}
              </div>

              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: '0.25rem' }}>BRUSH SIZE</span>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {[2, 5, 10].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBrushSize(s)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: brushSize === s ? 'var(--color-primary)' : 'var(--text-muted)',
                      fontWeight: brushSize === s ? 700 : 500,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ 
                      display: 'inline-block', 
                      width: `${s + 2}px`, 
                      height: `${s + 2}px`, 
                      borderRadius: '50%', 
                      backgroundColor: color,
                      border: '1px solid rgba(255,255,255,0.2)'
                    }} />
                    <span>{s === 2 ? 'Fine' : s === 5 ? 'Medium' : 'Thick'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Footer Save & Close */}
      <div style={{
        padding: '1rem',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        gap: '0.5rem',
        backgroundColor: 'rgba(var(--color-primary-rgb), 0.02)'
      }}>
        <button 
          onClick={handleSaveAll}
          className="premium-btn premium-btn-primary" 
          style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem', borderRadius: '4px' }}
        >
          <Save size={14} />
          <span>Save Workspace</span>
        </button>
        
        <button 
          onClick={onClose}
          className="premium-btn premium-btn-secondary" 
          style={{ fontSize: '0.8rem', padding: '0.5rem', borderRadius: '4px' }}
        >
          Close
        </button>
      </div>
    </div>
  );
};
