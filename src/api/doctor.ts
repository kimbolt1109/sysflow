import type { FlowApp } from "@/app";
import { renderDoctor } from "@/domain/doctor";

export async function runDoctor(app: FlowApp): Promise<number> {
  const { text, failed } = renderDoctor(await app.diagnose());
  process.stdout.write(`${text}\n`);
  return failed ? 1 : 0;
}
