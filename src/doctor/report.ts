export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  fixSuggestion?: string;
}

export interface DoctorReportSummary {
  pass: number;
  warn: number;
  fail: number;
}

export function summarizeDoctorResults(results: DoctorCheckResult[]): DoctorReportSummary {
  return results.reduce<DoctorReportSummary>(
    (summary, result) => {
      summary[result.status] += 1;
      return summary;
    },
    {
      pass: 0,
      warn: 0,
      fail: 0
    },
  );
}

export function renderDoctorReport(results: DoctorCheckResult[]): string {
  return results
    .map((result) => {
      const lines = [
        `[${result.status.toUpperCase()}] ${result.title}`,
        `  ${result.detail}`
      ];

      if (result.fixSuggestion) {
        lines.push(`  Fix: ${result.fixSuggestion}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
