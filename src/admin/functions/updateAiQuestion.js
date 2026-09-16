export async function updateAiQuestion({ questions, theme, token, clearExisting }) {
  const payload = {
    questions,
    themename: theme,
    organizationId: localStorage.getItem("organizationId"), // or however you store
    sessionId: localStorage.getItem("sessionId"),
    clear_existing: clearExisting ? 1 : 0
  };

  const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/addAIQuestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || "Failed to save AI-generated questions");
  }

  return resp.json();
}
