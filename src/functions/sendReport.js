import axios from 'axios';

const CLIENT_SECRET = process.env.REACT_APP_CLIENT_SECRET;
const BASE_URL = process.env.REACT_APP_REPORTS_BASE_URL;

const uuid4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

/** Pull report id from game-server responses (shape varies by endpoint). */
export function extractReportIdFromResponse(payload) {
  if (payload == null || typeof payload !== 'object') return null;
  const candidates = [
    payload.id,
    payload.reportId,
    payload.report_id,
    payload.data?.id,
    payload.data?.reportId,
    payload.data?.report_id,
    payload.result?.id,
    payload.result?.reportId,
    payload.report?.id,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim();
  }
  return null;
}


export async function refreshToken(currentToken) {
  const url = `${BASE_URL}/auth/rf-token`;
  const headers = {
    'client-secret': CLIENT_SECRET,
    'Content-Type': 'application/json',
    ...(currentToken && { Authorization: `Bearer ${currentToken}` }),
    'Idempotency-Key': uuid4(),
  };
  const response = await axios.get(url, { headers });
  return response.data.token;
}

export async function sendReport(data) {
  const { sessionId, role, token } = data;
  if (role === 'demobypass') return true;

  const isGuest = role === 'GUEST_USER';
  if (isGuest) {
    const endpoint = data.reportId ? 'game/update/guest/score' : 'game/add/guest/score';
    const guestPayload = data.reportId
      ? { points: data.points, time: data.time, reportId: data.reportId }
      : {
          points: data.points,
          time: data.time,
          gameId: data.gameId,
          name: data.name,
          sessionId: data.sessionId,
          userId: data.userId,
          organizationId: data.organizationId,
          ans: "",
        };
    const url = `${BASE_URL}/${endpoint}`;
    const method = data.reportId ? 'put' : 'post';
    const headers = {
      'client-secret': CLIENT_SECRET,
      'Content-Type': 'application/json',
      'Idempotency-Key': uuid4(),
    };
    const response = await axios({ method, url, headers, data: guestPayload });
    return response.data;
  }

  // Registered user logic
  const isUpdate = Boolean(data.reportId);
  const url = isUpdate
    ? `${BASE_URL}/game-server/report/${data.reportId}`
    : `${BASE_URL}/game-server/report/add`;
  const method = isUpdate ? 'put' : 'post';

  let headers = {
    'client-secret': CLIENT_SECRET,
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': uuid4(),
  };

  try {
    const response = await axios({ method, url, headers, data });
    return response.data;
  } catch (err) {
    if (err.response?.status === 401) {
      const newToken = await refreshToken(token);
      headers.Authorization = `Bearer ${newToken}`;
      const retry = await axios({ method, url, headers, data });
      return retry.data;
    }
    throw err;
  }
}