import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export function TiltCard({ children, className = "", animatedBorder = false, style }) {
  const ref = useRef(null);

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const rotateY = useSpring(rawX, { stiffness: 260, damping: 28 });
  const rotateX = useSpring(rawY, { stiffness: 260, damping: 28 });

  const glareX = useTransform(rawX, [-1, 1], ["20%", "80%"]);
  const glareY = useTransform(rawY, [-1, 1], ["80%", "20%"]);
  const glareOpacity = useMotionValue(0);

  function handleMouseMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    rawX.set(x * 9);
    rawY.set(-y * 9);
    glareOpacity.set(1);
  }

  function handleMouseLeave() {
    rawX.set(0);
    rawY.set(0);
    glareOpacity.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={`tilt-root ${animatedBorder ? "animated-border-card" : ""} ${className}`}
      style={{ ...style, rotateX, rotateY, transformPerspective: 800 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <motion.div
        className="tilt-glare"
        aria-hidden="true"
        style={{
          opacity: glareOpacity,
          background: useTransform(
            [glareX, glareY],
            ([gx, gy]) =>
              `radial-gradient(circle at ${gx} ${gy}, rgba(255,255,255,0.14), transparent 65%)`
          ),
        }}
      />
    </motion.div>
  );
}
