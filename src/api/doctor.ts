import type { FlowApp } from "@/app.js";
import { renderDoctor } from "@/domain/doctor.js";

export async function runDoctor(app: FlowApp): Promise<number> {
  const { text, failed } = renderDoctor(await app.diagnose());
  process.stdout.write(`${text}\n`);
  return failed ? 1 : 0;
}
