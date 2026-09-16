export async function saveAdminQuestions({ currentTheme, organizationId, sessionId, token, questions, filesByIndex }) {
  const fd = new FormData();
  fd.append("currentTheme", currentTheme || "");
  fd.append("organizationId", organizationId || "admin");
  fd.append("sessionId", sessionId || "admin");
  fd.append("questions", JSON.stringify(questions || []));

  Object.entries(filesByIndex || {}).forEach(([idx, file]) => {
    if (!file) return;
    fd.append(`image_${idx}`, file);
  });

  const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/saveAdminQuestions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: fd,
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body?.success === false) {
    throw new Error(body?.message || body?.error || "Failed to save questions");
  }
  return body;
}

