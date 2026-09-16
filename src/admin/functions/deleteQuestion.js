export async function deleteQuestionById({ id, token }) {
  const resp = await fetch(`${process.env.REACT_APP_BACKEND_URL}/deleteQuestion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.message || 'Failed to delete question');
  }

  return resp.json(); // { success: true, message: 'Question deleted successfully' }
}
