document.addEventListener("DOMContentLoaded", () => {
  const waveEl = document.querySelector(".wave-text");
  const text = waveEl.textContent;
  waveEl.textContent = "";
  [...text].forEach((char, i) => {
    const span = document.createElement("span");
    span.innerHTML = char === " " ? "&nbsp;" : char;
    span.style.animationDelay = `${i * 0.06}s`;
    waveEl.appendChild(span);
  });
});
document.getElementById("tv").addEventListener("click", () => {
  const isMobile = window.innerWidth <= 768;
  const width = isMobile ? window.innerWidth * 0.8 : 400;
  const height = isMobile ? window.innerHeight * 0.6 : 600;

  const chatWindow = window.open("https://www3.cbox.ws/box/?boxid=3546133&boxtag=UkIQjc", 
                                "chat", 
                                `width=${width},height=${height},scrollbars=yes,resizable=yes`);
  if (!chatWindow) {
    alert("Please allow pop-ups for this site.");
  }
});
