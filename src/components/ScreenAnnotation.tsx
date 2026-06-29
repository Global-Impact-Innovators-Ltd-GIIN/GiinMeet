import React, { useRef, useState, useEffect } from 'react';
import { Edit2, Sparkles, Trash2, X } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
}

interface RemoteCursor {
  name: string;
  x: number;
  y: number;
  color: string;
  isDrawing: boolean;
}

interface ScreenAnnotationProps {
  isPresenter: boolean;
  onClose: () => void;
  sigChannelRef?: React.MutableRefObject<any>;
  myKey: string;
  userName: string;
}

export const ScreenAnnotation: React.FC<ScreenAnnotationProps> = ({ 
  isPresenter, 
  onClose,
  sigChannelRef,
  myKey,
  userName: _userName
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#FABD02'); // Gold accent by default
  const [brushSize, setBrushSize] = useState(3);
  const [toolMode, setToolMode] = useState<'pen' | 'laser'>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const lastPosRef = useRef<Point | null>(null);

  // Active remote cursors
  const [remoteCursors] = useState<RemoteCursor[]>([]);

  const canvasWidth = 800;
  const canvasHeight = 450;

  // Redraw canvas whenever strokes or remote cursors change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all completed strokes
    strokes.forEach(stroke => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });

    // Draw current active stroke
    if (currentPoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
      }
      ctx.stroke();
    }

    // Draw remote cursors & name tags
    remoteCursors.forEach(rc => {
      // Draw cursor pointer dot
      ctx.fillStyle = rc.color;
      ctx.beginPath();
      ctx.arc(rc.x, rc.y, rc.isDrawing ? 4 : 6, 0, 2 * Math.PI);
      ctx.fill();

      // Spotlight glow if laser mode/drawing
      if (rc.isDrawing) {
        ctx.strokeStyle = rc.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rc.x, rc.y, 14, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Name tag container
      ctx.fillStyle = rc.color;
      ctx.font = '500 11px sans-serif';
      const textWidth = ctx.measureText(rc.name).width;
      ctx.fillRect(rc.x + 8, rc.y - 12, textWidth + 8, 18);

      // Name text
      ctx.fillStyle = '#000000';
      ctx.fillText(rc.name, rc.x + 12, rc.y);
    });
  }, [strokes, currentPoints, remoteCursors, drawColor, brushSize]);

  // Remote annotations listener
  useEffect(() => {
    if (!sigChannelRef?.current) return;

    const channel = sigChannelRef.current;

    const onDraw = (payload: any) => {
      const data = payload.payload;
      if (data.senderKey !== myKey) {
        setStrokes(prev => [...prev, { points: data.points, color: data.color, size: data.size }]);
      }
    };

    const onClear = (payload: any) => {
      const data = payload.payload;
      if (data.senderKey !== myKey) {
        setStrokes([]);
        setCurrentPoints([]);
      }
    };

    channel.on('broadcast', { event: 'draw-annotation' }, onDraw);
    channel.on('broadcast', { event: 'clear-annotation' }, onClear);

    return () => {
      // Handled by parent channel teardown
    };
  }, [sigChannelRef, myKey]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Scale coordinate mappings relative to responsive canvas dimensions
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPresenter) return;
    const coord = getCoordinates(e);
    setIsDrawing(true);
    lastPosRef.current = coord;
    
    if (toolMode === 'pen') {
      setCurrentPoints([coord]);
    } else if (toolMode === 'laser') {
      // Laser trigger: draws a brief spotlight point, then clears after delay
      const laserPoint: Stroke = {
        points: [coord, { x: coord.x + 1, y: coord.y + 1 }],
        color: 'rgba(250, 189, 2, 0.8)',
        size: 8
      };
      setStrokes(prev => [...prev, laserPoint]);
      setTimeout(() => {
        setStrokes(prev => prev.filter(s => s !== laserPoint));
      }, 1000);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPresenter || !isDrawing || !lastPosRef.current) return;
    const coord = getCoordinates(e);

    if (toolMode === 'pen') {
      setCurrentPoints(prev => [...prev, coord]);

      // Broadcast this line segment to other participants
      if (sigChannelRef?.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'draw-annotation',
          payload: {
            points: [lastPosRef.current, coord],
            color: drawColor,
            size: brushSize,
            senderKey: myKey
          }
        });
      }
    }
    lastPosRef.current = coord;
  };

  const handleMouseUp = () => {
    if (!isPresenter || !isDrawing) return;
    setIsDrawing(false);
    lastPosRef.current = null;
    
    if (toolMode === 'pen' && currentPoints.length > 0) {
      setStrokes(prev => [...prev, { points: currentPoints, color: drawColor, size: brushSize }]);
      setCurrentPoints([]);
    }
  };

  const handleClear = () => {
    setStrokes([]);
    setCurrentPoints([]);

    if (isPresenter && sigChannelRef?.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'clear-annotation',
        payload: { senderKey: myKey }
      });
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: 20,
      pointerEvents: isPresenter ? 'auto' : 'none',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Interactive canvas layer */}
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          width: '100%',
          height: '100%',
          cursor: isPresenter ? (toolMode === 'laser' ? 'crosshair' : 'pencil') : 'default',
          pointerEvents: isPresenter ? 'auto' : 'none',
          backgroundColor: 'transparent'
        }}
      />

      {/* Floating Toolbar panel (Only visible for the presenter) */}
      {isPresenter && (
        <div className="glass-panel flex-between" style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '0.65rem 1.25rem',
          backgroundColor: 'rgba(18, 24, 38, 0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 'var(--radius-lg)',
          pointerEvents: 'auto',
          gap: '1.5rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          animation: 'pop-in 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>CO-DRAW:</span>
            
            {/* Pen mode */}
            <button
              onClick={() => setToolMode('pen')}
              style={{
                background: toolMode === 'pen' ? 'var(--color-primary)' : 'transparent',
                border: '1px solid var(--border-color)',
                color: 'white',
                borderRadius: '4px',
                padding: '0.4rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Pen Drawing Mode"
            >
              <Edit2 size={14} color={toolMode === 'pen' ? 'var(--color-accent)' : 'white'} />
            </button>

            {/* Laser mode */}
            <button
              onClick={() => setToolMode('laser')}
              style={{
                background: toolMode === 'laser' ? 'var(--color-primary)' : 'transparent',
                border: '1px solid var(--border-color)',
                color: 'white',
                borderRadius: '4px',
                padding: '0.4rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Laser Pointer Spotlight"
            >
              <Sparkles size={14} color={toolMode === 'laser' ? 'var(--color-accent)' : 'white'} />
            </button>
          </div>

          {/* Color selectors */}
          {toolMode === 'pen' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {['#FABD02', '#EF4444', '#10B981', '#3B82F6', '#FFFFFF'].map(c => (
                <button
                  key={c}
                  onClick={() => setDrawColor(c)}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: drawColor === c ? '2px solid white' : '1px solid transparent',
                    cursor: 'pointer',
                    padding: 0
                  }}
                />
              ))}
            </div>
          )}

          {/* Brush size slider */}
          {toolMode === 'pen' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Brush:</span>
              <input 
                type="range" 
                min={1} 
                max={10} 
                value={brushSize} 
                onChange={(e) => setBrushSize(Number(e.target.value))}
                style={{ width: '60px', cursor: 'pointer' }}
              />
            </div>
          )}

          {/* Actions clear/close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '1px solid #1E293B', paddingLeft: '1rem' }}>
            <button
              onClick={handleClear}
              style={{
                background: 'none',
                border: 'none',
                color: '#EF4444',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0.25rem'
              }}
              title="Clear All Annotations"
            >
              <Trash2 size={15} />
            </button>
            
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0.25rem'
              }}
              title="Turn Off Annotation Overlay"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
