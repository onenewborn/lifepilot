function compactText(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function joinTags(items, limit = 4) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function moneyText(value) {
  const number = Number(value || 0);
  return number > 0 ? `人均 ${number}` : "";
}

module.exports = {
  compactText,
  joinTags,
  moneyText
};
