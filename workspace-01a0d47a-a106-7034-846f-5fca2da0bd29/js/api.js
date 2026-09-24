let csrf = "";

export function setCsrf(value) {
  csrf = value || "";
}

export function getCsrf() {
  return csrf;
}

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (csrf && method !== "GET" && method !== "HEAD") reqHeaders["X-CSRF-Token"] = csrf;
  let payload;
  if (body !== undefined) {
    reqHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, credentials: "same-origin", headers: reqHeaders, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "request_failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function me() {
  const data = await api("/api/auth/me");
  setCsrf(data.csrf || "");
  return data;
}

export function uploadFile(file, { purpose = "site-photo", onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.withCredentials = true;
    if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const err = new Error(data.error || "upload_failed");
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file, "upload");
    xhr.send(form);
  });
}
