export async function updateThemeData({ payload, token }) {
  const resp = await fetch(
    `${process.env.REACT_APP_BACKEND_URL}/updateMultiple`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update admin settings");
  }

  return resp.json();
}