import React, { useEffect, useRef, useState } from 'react';

// ----------------------------------------------------
// 1. FINGERPRINT VISUALIZER (For Scraper Console)
// ----------------------------------------------------
export function FingerprintVisualizer({ mode }) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, rx: 0, ry: 0, isDown: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    // 3D Point class
    class Point3D {
      constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
    }

    let points = [];
    let connections = [];

    const generateSphere = () => {
      points = [];
      connections = [];
      const numPoints = 60;
      for (let i = 0; i < numPoints; i++) {
        const phi = Math.acos(-1 + (2 * i) / numPoints);
        const theta = Math.sqrt(numPoints * Math.PI) * phi;
        const radius = 60;
        const x = radius * Math.cos(theta) * Math.sin(phi);
        const y = radius * Math.sin(theta) * Math.sin(phi);
        const z = radius * Math.cos(phi);
        points.push(new Point3D(x, y, z));
      }
      // Connections
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const dz = points[i].z - points[j].z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 40) {
            connections.push([i, j]);
          }
        }
      }
    };

    const generateCube = () => {
      points = [];
      connections = [];
      const size = 45;
      // 8 corners
      points.push(new Point3D(-size, -size, -size));
      points.push(new Point3D(size, -size, -size));
      points.push(new Point3D(size, size, -size));
      points.push(new Point3D(-size, size, -size));
      points.push(new Point3D(-size, -size, size));
      points.push(new Point3D(size, -size, size));
      points.push(new Point3D(size, size, size));
      points.push(new Point3D(-size, size, size));

      connections = [
        [0, 1], [1, 2], [2, 3], [3, 0], // back face
        [4, 5], [5, 6], [6, 7], [7, 4], // front face
        [0, 4], [1, 5], [2, 6], [3, 7]  // links
      ];

      // Add a few inner points for matrix feel
      for (let i = 0; i < 15; i++) {
        points.push(new Point3D(
          (Math.random() - 0.5) * size * 1.5,
          (Math.random() - 0.5) * size * 1.5,
          (Math.random() - 0.5) * size * 1.5
        ));
      }
    };

    const generateHelix = () => {
      points = [];
      connections = [];
      const numPoints = 50;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 6;
        const radius = 40;
        const x = radius * Math.cos(t);
        const z = radius * Math.sin(t);
        const y = (i - numPoints / 2) * 2.5;
        points.push(new Point3D(x, y, z));
        if (i > 0) connections.push([i - 1, i]);
      }
    };

    const buildModel = () => {
      if (mode === 'stealthy') generateSphere();
      else if (mode === 'dynamic') generateCube();
      else generateHelix();
    };

    buildModel();

    let rotX = 0;
    let rotY = 0;

    const handleMouseDown = (e) => {
      mouseRef.current.isDown = true;
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    const handleMouseMove = (e) => {
      if (!mouseRef.current.isDown) return;
      const dx = e.clientX - mouseRef.current.x;
      const dy = e.clientY - mouseRef.current.y;
      mouseRef.current.rx += dx * 0.005;
      mouseRef.current.ry += dy * 0.005;
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    const handleMouseUp = () => {
      mouseRef.current.isDown = false;
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const fov = 300;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      rotX += 0.006;
      rotY += 0.008;

      const totalX = rotX + mouseRef.current.ry;
      const totalY = rotY + mouseRef.current.rx;

      const cosX = Math.cos(totalX);
      const sinX = Math.sin(totalX);
      const cosY = Math.cos(totalY);
      const sinY = Math.sin(totalY);

      const projected = [];

      // Project points
      for (let i = 0; i < points.length; i++) {
        const p = points[i];

        // Rotate Y
        let x1 = p.x * cosY - p.z * sinY;
        let z1 = p.z * cosY + p.x * sinY;

        // Rotate X
        let y2 = p.y * cosX - z1 * sinX;
        let z2 = z1 * cosX + p.y * sinX;

        // Projection
        const scale = fov / (fov + z2);
        const px = x1 * scale + width / 2;
        const py = y2 * scale + height / 2;

        projected.push({ x: px, y: py, z: z2, scale: scale });
      }

      const activeColor = mode === 'stealthy' ? '#ff2a5f' : (mode === 'dynamic' ? '#00b4fc' : '#a855f7');
      const activeColorRGBA = mode === 'stealthy' ? 'rgba(255, 42, 95,' : (mode === 'dynamic' ? 'rgba(0, 180, 252,' : 'rgba(168, 85, 247,');

      // Draw Connections
      ctx.lineWidth = 1;
      for (let i = 0; i < connections.length; i++) {
        const p1 = projected[connections[i][0]];
        const p2 = projected[connections[i][1]];

        const avgZ = (p1.z + p2.z) / 2;
        const opacity = Math.max(0.1, Math.min(0.8, 1 - avgZ / 100));

        ctx.strokeStyle = activeColorRGBA + opacity + ')';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Draw Points
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        const radius = Math.max(1, p.scale * 3);
        const opacity = Math.max(0.2, Math.min(0.9, 1 - p.z / 100));

        ctx.fillStyle = activeColorRGBA + opacity + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();

        if (p.z < 0) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = activeColor;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Draw Status Text Overlay
      ctx.fillStyle = activeColor;
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`ENGINE: ${mode.toUpperCase()}`, width / 2, height - 12);

      animationId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleResize);
    };
  }, [mode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '180px', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.03)', overflow: 'hidden', cursor: 'grab' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <span style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '9px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        DRAG MOUSE TO ROTATE
      </span>
    </div>
  );
}

// ----------------------------------------------------
// 2. LIVE SEARCH NODE MAP (For Discovery Engine)
// ----------------------------------------------------
export function DiscoveryNodeMap({ query, results, onSelectNode }) {
  const canvasRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    // Node class with spring physics
    class Node {
      constructor(id, label, x, y, size, color, isCenter = false, url = '') {
        this.id = id;
        this.label = label;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.size = size;
        this.color = color;
        this.isCenter = isCenter;
        this.url = url;
      }
    }

    const nodes = [];
    const centerNode = new Node(0, query || 'Discovery Engine', width / 2, height / 2, 22, '#00b4fc', true);
    nodes.push(centerNode);

    // Generate result nodes
    if (results && results.length > 0) {
      results.slice(0, 10).forEach((res, i) => {
        const angle = (i / Math.min(10, results.length)) * Math.PI * 2;
        const dist = 100 + Math.random() * 40;
        const x = width / 2 + Math.cos(angle) * dist;
        const y = height / 2 + Math.sin(angle) * dist;
        nodes.push(new Node(i + 1, res.title, x, y, 10, '#00f09a', false, res.url));
      });
    }

    let mouseX = -9999;
    let mouseY = -9999;
    let activeNode = null;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;

      let found = null;
      for (const node of nodes) {
        const dist = Math.hypot(node.x - mouseX, node.y - mouseY);
        if (dist < node.size + 6) {
          found = node;
          break;
        }
      }
      setHoveredNode(found);
      activeNode = found;
    };

    const handleClick = () => {
      if (activeNode && activeNode.url && onSelectNode) {
        onSelectNode(activeNode.url);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Physics loop
      const k = 0.015; // Spring stiffness
      const d = 0.85;  // Damping factor
      const rep = 400; // Repulsion factor

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        if (n1.isCenter) {
          // Keep center tied closely to screen middle
          n1.vx += (width / 2 - n1.x) * 0.05;
          n1.vy += (height / 2 - n1.y) * 0.05;
        }

        // Force calculations
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 1;

          // Repulsion
          if (dist < 120) {
            const force = rep / (dist * dist);
            n1.vx -= (dx / dist) * force;
            n1.vy -= (dy / dist) * force;
          }
        }

        // Spring connection to center
        if (!n1.isCenter) {
          const dx = centerNode.x - n1.x;
          const dy = centerNode.y - n1.y;
          const dist = Math.hypot(dx, dy);
          const restLength = 120;
          const force = (dist - restLength) * k;
          n1.vx += (dx / dist) * force;
          n1.vy += (dy / dist) * force;
        }

        // Update positions
        n1.x += n1.vx;
        n1.y += n1.vy;
        n1.vx *= d;
        n1.vy *= d;

        // Containment
        n1.x = Math.max(n1.size, Math.min(width - n1.size, n1.x));
        n1.y = Math.max(n1.size, Math.min(height - n1.size, n1.y));
      }

      // Draw connections
      ctx.lineWidth = 1;
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i];
        ctx.strokeStyle = 'rgba(0, 180, 252, 0.15)';
        ctx.beginPath();
        ctx.moveTo(centerNode.x, centerNode.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = n.color;

        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        ctx.fill();

        // White inner core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Draw small label
        if (n.isCenter) {
          ctx.fillStyle = 'var(--text-main)';
          ctx.font = 'bold 11px "Outfit", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.label.substring(0, 22) + (n.label.length > 22 ? '..' : ''), n.x, n.y - n.size - 6);
        }
      }

      // Cursor interaction lines
      if (activeNode) {
        ctx.strokeStyle = activeNode.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(activeNode.x, activeNode.y, activeNode.size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('resize', handleResize);
    };
  }, [query, results]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '240px', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.03)', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {hoveredNode && hoveredNode.id !== 0 && (
        <div style={{ position: 'absolute', bottom: '8px', left: '10px', right: '10px', background: 'rgba(5, 6, 8, 0.95)', border: '1px solid var(--secondary)', borderRadius: '6px', padding: '0.4rem 0.6rem', pointerEvents: 'none' }}>
          <p style={{ fontSize: '10px', color: 'var(--secondary)', fontWeight: 'bold', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            NODE LINK: {hoveredNode.label}
          </p>
          <span style={{ fontSize: '8px', color: 'var(--success)' }}>CLICK NODE TO OPEN SCRAPER CONSOLE</span>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 3. CYBER CORE ring status (For Persistent Sessions)
// ----------------------------------------------------
export function SessionCoreVisualizer({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    const width = (canvas.width = 60);
    const height = (canvas.height = 60);

    let angle = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      angle += active ? 0.05 : 0.015;

      const cx = width / 2;
      const cy = height / 2;

      // Glow backdrop
      ctx.save();
      ctx.shadowBlur = active ? 12 : 5;
      ctx.shadowColor = active ? '#00b4fc' : '#555';

      // Ring 1 (Outer)
      ctx.strokeStyle = active ? 'rgba(0, 180, 252, 0.8)' : 'rgba(100, 100, 100, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, angle, angle + Math.PI * 1.5);
      ctx.stroke();

      // Ring 2 (Inner, Counter-rotating)
      ctx.strokeStyle = active ? 'rgba(255, 42, 95, 0.6)' : 'rgba(120, 120, 120, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, -angle * 1.5, -angle * 1.5 + Math.PI * 0.8);
      ctx.stroke();

      // Core dot
      ctx.fillStyle = active ? '#00b4fc' : '#666';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [active]);

  return <canvas ref={canvasRef} style={{ width: '60px', height: '60px', display: 'inline-block' }} />;
}

// ----------------------------------------------------
// 4. HOLOGRAPHIC ARCHIVE STACK (For Research Library)
// ----------------------------------------------------
export function HoloArchiveStack({ items, onSelectItem }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    let hoverIdx = -1;
    let floatOffset = 0;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Detect hover over plates
      let found = -1;
      const numPlates = Math.min(5, items?.length || 0);
      const plateHeight = 22;
      const startY = height / 2 - (numPlates * plateHeight) / 2;

      for (let i = 0; i < numPlates; i++) {
        const py = startY + i * plateHeight;
        if (mx > width / 2 - 80 && mx < width / 2 + 80 && my > py - 10 && my < py + 12) {
          found = i;
          break;
        }
      }
      hoverIdx = found;
    };

    const handleClick = () => {
      if (hoverIdx !== -1 && items[hoverIdx] && onSelectItem) {
        onSelectItem(items[hoverIdx]);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      floatOffset += 0.02;
      const numPlates = Math.min(5, items?.length || 0);
      if (numPlates === 0) {
        // Draw empty standby grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = 10; y < height; y += 15) {
          ctx.moveTo(10, y);
          ctx.lineTo(width - 10, y);
        }
        ctx.stroke();
        return;
      }

      const plateHeight = 24;
      const startY = height / 2 - (numPlates * plateHeight) / 2;

      // Project plates as rotating 3D isometric discs
      for (let i = numPlates - 1; i >= 0; i--) {
        const isHovered = hoverIdx === i;
        const cy = startY + i * plateHeight + Math.sin(floatOffset + i) * 3;
        const rx = 70 + (isHovered ? 12 : 0);
        const ry = 18 + (isHovered ? 4 : 0);
        const cx = width / 2;

        ctx.save();
        ctx.lineWidth = 1.5;

        // Glow
        ctx.shadowBlur = isHovered ? 15 : 4;
        ctx.shadowColor = isHovered ? '#ff2a5f' : '#00b4fc';

        // Disk Gradient
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        grad.addColorStop(0, isHovered ? 'rgba(255, 42, 95, 0.25)' : 'rgba(0, 180, 252, 0.15)');
        grad.addColorStop(1, 'rgba(5, 6, 8, 0.8)');

        ctx.fillStyle = grad;
        ctx.strokeStyle = isHovered ? '#ff2a5f' : 'rgba(0, 180, 252, 0.5)';

        // Draw ellipse
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner ring
        ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0, 180, 252, 0.3)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.4, ry * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();

        // Title preview next to plate
        if (isHovered && items[i]) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px "Outfit", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(items[i].title.substring(0, 24) + '...', cx, cy + 3);
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('resize', handleResize);
    };
  }, [items]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '180px', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.03)', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <span style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '9px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        HOLOGRAPHIC ARCHIVE PILE
      </span>
    </div>
  );
}

// ----------------------------------------------------
// 5. PYTHON TERMINAL STREAMER (For Script Generator)
// ----------------------------------------------------
export function CodeTerminalStreamer() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const pythonSnippets = [
      'from scrapling import Fetcher',
      'StealthyFetcher.fetch(url)',
      'response.css(".quote")',
      'response.xpath("//div")',
      'item.markdown',
      'with DynamicSession() as s:',
      'session.fetch(url)',
      'result.items.to_json()',
      'yield Request(link)',
      'page.get_all_text()',
      'headless=True',
      'solve_cloudflare=True'
    ];

    class CodeDrop {
      constructor() {
        this.reset();
        this.y = Math.random() * height; // Random start position
      }

      reset() {
        this.text = pythonSnippets[Math.floor(Math.random() * pythonSnippets.length)];
        this.x = Math.random() * width;
        this.y = -20;
        this.speed = Math.random() * 0.8 + 0.3;
        this.opacity = Math.random() * 0.5 + 0.1;
        this.size = Math.random() * 3 + 8;
      }

      update() {
        this.y += this.speed;
        if (this.y > height + 20) {
          this.reset();
        }
      }

      draw() {
        ctx.fillStyle = `rgba(0, 180, 252, ${this.opacity})`;
        ctx.font = `${this.size}px "JetBrains Mono", monospace`;
        ctx.fillText(this.text, this.x, this.y);
      }
    }

    const count = 12;
    const drops = [];
    for (let i = 0; i < count; i++) {
      drops.push(new CodeDrop());
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw running drops
      for (const d of drops) {
        d.update();
        d.draw();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100px', borderRadius: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.03)', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <span style={{ position: 'absolute', top: '8px', left: '10px', fontSize: '9px', fontFamily: 'monospace', color: 'rgba(0, 180, 252, 0.7)', fontWeight: 'bold' }}>
        SYSTEM PIPELINE LOG STREAMER
      </span>
    </div>
  );
}
