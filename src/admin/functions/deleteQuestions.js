export async function deleteAllQuestions({ currentTheme,token }) {
  const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/deleteAllQuestions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ currentTheme }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.message || 'Failed to fetch user questions');
  }
  return resp.json(); 
}
