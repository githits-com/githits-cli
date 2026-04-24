export type CodeNavigationCapability = "enabled" | "disabled" | "unknown";

interface JwtPayload {
  code_navigation?: unknown;
  codeNavigation?: unknown;
  capabilities?: unknown;
}

export function getCodeNavigationCapability(
  accessToken: string | undefined,
): CodeNavigationCapability {
  if (!accessToken) {
    return "unknown";
  }

  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return "unknown";
  }

  if (payload.code_navigation === true || payload.codeNavigation === true) {
    return "enabled";
  }

  if (payload.code_navigation === false || payload.codeNavigation === false) {
    return "disabled";
  }

  if (Array.isArray(payload.capabilities)) {
    return payload.capabilities.includes("code_navigation")
      ? "enabled"
      : "disabled";
  }

  return "unknown";
}

function decodeJwtPayload(accessToken: string): JwtPayload | undefined {
  const [, encodedPayload] = accessToken.split(".");
  if (!encodedPayload) {
    return undefined;
  }

  try {
    const normalized = encodedPayload
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}