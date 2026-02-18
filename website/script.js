const revealNodes = [...document.querySelectorAll(".reveal")];

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);

revealNodes.forEach((node, index) => {
  node.style.transitionDelay = `${Math.min(index * 30, 220)}ms`;
  observer.observe(node);
});

const yearNode = document.querySelector("#year");
if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

