export async function getQuestionsCSV({ currentTheme, token }) {
  const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/getQuestionsCSV`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({currentTheme }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.message || 'Failed to fetch CSV');
  }
  // this response will be a CSV string, so you can do:
  const blob = await resp.blob();
  return blob;
}