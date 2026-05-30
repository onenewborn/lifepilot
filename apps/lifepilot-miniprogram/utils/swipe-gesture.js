function dragStyles(dx, dy) {
  const rotate = Math.max(-10, Math.min(10, dx / 18));
  const dragDistance = Math.abs(dx);
  const intensity = Math.min(1, (dragDistance + 28) / 118);
  const cardScale = 0.985 + Math.min(0.025, Math.abs(dx) / 900);
  const activeScale = 0.9 + intensity * 0.14;
  return {
    cardStyle: `transition: none; transform: translate(${dx}px, ${dy}px) rotate(${rotate}deg) scale(${cardScale});`,
    keepFeedbackStyle: dx > 0
      ? `opacity: ${intensity}; transform: scale(${activeScale});`
      : "opacity: 0; transform: scale(0.82);",
    dislikeFeedbackStyle: dx < 0
      ? `opacity: ${intensity}; transform: scale(${activeScale});`
      : "opacity: 0; transform: scale(0.82);"
  };
}

function flyStyles(action) {
  const direction = action === "keep" ? 1 : -1;
  const flyX = direction * 860;
  const flyRotate = direction * 14;
  return {
    cardStyle: `transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1); transform: translate(${flyX}px, -18px) rotate(${flyRotate}deg) scale(0.96);`,
    keepFeedbackStyle: action === "keep" ? "opacity: 1; transform: scale(1.05);" : "opacity: 0; transform: scale(0.82);",
    dislikeFeedbackStyle: action === "dislike" ? "opacity: 1; transform: scale(1.05);" : "opacity: 0; transform: scale(0.82);"
  };
}

function resetStyles() {
  return {
    cardStyle: "transition: transform 160ms ease-out; transform: translate(0, 0) rotate(0deg) scale(1);",
    keepFeedbackStyle: "opacity: 0; transform: scale(0.82);",
    dislikeFeedbackStyle: "opacity: 0; transform: scale(0.82);"
  };
}

module.exports = {
  dragStyles,
  flyStyles,
  resetStyles
};
