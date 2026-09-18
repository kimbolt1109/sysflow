export interface DoctorCheck {
  name: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}

export function renderDoctor(checks: DoctorCheck[]): { text: string; failed: boolean } {
  const lines = checks.map(
    (c) => `${c.ok ? "ok  " : c.warn === true ? "warn" : "FAIL"}  ${c.name}: ${c.detail}`,
  );
  const failed = checks.some((c) => !c.ok && c.warn !== true);
  return { text: lines.join("\n"), failed };
}
