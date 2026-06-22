import React, { useEffect, useRef } from 'react';

export default function CyberCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Particle class in 3D space
    class Particle {
      constructor() {
        this.reset();
      }

      reset() {
        this.colorType = Math.random() > 0.5 ? 'red' : 'blue';
        
        // Spawn red on the right half, blue on the left half of the 3D space
        const rangeX = Math.random() * 200 + 80;
        this.x = this.colorType === 'red' ? rangeX : -rangeX;
        this.y = (Math.random() - 0.5) * 500;
        this.z = (Math.random() - 0.5) * 400;
        
        // Drift speed
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.vz = (Math.random() - 0.5) * 0.3;
        
        this.color = this.colorType === 'red' ? 'rgba(255, 42, 95,' : 'rgba(0, 180, 252,';
        this.size = Math.random() * 1.8 + 1;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.z += this.vz;

        // Boundaries: keep red particles on the right, blue on the left
        if (this.colorType === 'red') {
          if (this.x < 30) {
            this.x = 30;
            this.vx *= -1;
          } else if (this.x > 500) {
            this.x = 500;
            this.vx *= -1;
          }
        } else {
          if (this.x > -30) {
            this.x = -30;
            this.vx *= -1;
          } else if (this.x < -500) {
            this.x = -500;
            this.vx *= -1;
          }
        }

        if (Math.abs(this.y) > 280) {
          this.y = Math.sign(this.y) * 280;
          this.vy *= -1;
        }
        if (Math.abs(this.z) > 250) {
          this.z = Math.sign(this.z) * 250;
          this.vz *= -1;
        }
      }
    }

    const count = 120;
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push(new Particle());
    }

    // Camera parameters
    const fov = 400; // Field of view (perspective)
    let rotY = 0.0015; // Speed of rotation around Y axis
    let rotX = 0.0008; // Speed of rotation around X axis

    // Mouse position tracking
    let mouseX = 0;
    let mouseY = 0;
    const handleMouseMove = (e) => {
      mouseX = (e.clientX - width / 2) * 0.05;
      mouseY = (e.clientY - height / 2) * 0.05;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Loop
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Simple 3D Rotation matrices
      const cosY = Math.cos(rotY + mouseX * 0.0005);
      const sinY = Math.sin(rotY + mouseX * 0.0005);
      const cosX = Math.cos(rotX + mouseY * 0.0005);
      const sinX = Math.sin(rotX + mouseY * 0.0005);

      // Update and project particles
      const projected = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.update();

        // Rotate Y
        let x1 = p.x * cosY - p.z * sinY;
        let z1 = p.z * cosY + p.x * sinY;

        // Rotate X
        let y2 = p.y * cosX - z1 * sinX;
        let z2 = z1 * cosX + p.y * sinX;

        // Perspective Projection (clamped to prevent negative or infinite scale values)
        const scale = Math.max(0.01, fov / Math.max(10, fov + z2));
        const projX = x1 * scale + width / 2;
        const projY = y2 * scale + height / 2;

        projected.push({
          x: projX,
          y: projY,
          z: z2,
          scale: scale,
          color: p.color,
          size: p.size
        });
      }

      // Draw lines between close particles in 3D
      ctx.lineWidth = 0.5;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const p1 = projected[i];
          const p2 = projected[j];

          // Calculate 2D distance
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist2D = Math.sqrt(dx * dx + dy * dy);

          if (dist2D < 120) {
            // Fade line based on distance
            const alpha = (1 - dist2D / 120) * 0.15;
            // Create a gradient line between red and blue if particles are different colors
            const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
            grad.addColorStop(0, p1.color + alpha + ')');
            grad.addColorStop(1, p2.color + alpha + ')');
            
            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      // Draw particles (larger when closer to camera)
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        ctx.fillStyle = p.color + (p.scale * 0.8) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.scale, 0, Math.PI * 2);
        ctx.fill();
        
        // Add a subtle glow for the closest ones
        if (p.z < 0) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = p.color === 'rgba(255, 42, 95,' ? '#ff2a5f' : '#00b4fc';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.scale * 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0; // Reset
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
        background: 'transparent'
      }}
    />
  );
}
