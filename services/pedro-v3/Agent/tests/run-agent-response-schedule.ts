import {
  DEFAULT_RESPONSE_DAYS,
  isWithinAgentResponseSchedule,
  normalizeAgentResponseSchedule,
  type AgentResponseSchedule,
} from "../src/domain/agent-response-schedule.ts";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) { passed += 1; console.log(`OK ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}`); }
}

const overnightSunday: AgentResponseSchedule = {
  enabled: true, start: "18:00", end: "08:00", days: [7], timezone: "America/Sao_Paulo",
};
check("desligado deixa responder sempre", isWithinAgentResponseSchedule("2026-07-19T03:00:00Z", { ...overnightSunday, enabled: false }));
check("domingo 18h inicia janela noturna", isWithinAgentResponseSchedule("2026-07-19T21:00:00Z", overnightSunday));
check("segunda 07:59 pertence à janela iniciada domingo", isWithinAgentResponseSchedule("2026-07-20T10:59:00Z", overnightSunday));
check("segunda 08h encerra janela noturna", !isWithinAgentResponseSchedule("2026-07-20T11:00:00Z", overnightSunday));
check("segunda 18h não é incluída quando só domingo foi marcado", !isWithinAgentResponseSchedule("2026-07-20T21:00:00Z", overnightSunday));
check("janela normal respeita o dia selecionado", isWithinAgentResponseSchedule("2026-07-20T15:00:00Z", { ...overnightSunday, start: "08:00", end: "18:00", days: [1] }));
check("domingo fica fechado na janela seg-sáb", !isWithinAgentResponseSchedule("2026-07-19T15:00:00Z", { ...overnightSunday, start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] }));
check("normalização usa dias padrão para agente antigo", normalizeAgentResponseSchedule({ businessHoursOnly: true, businessHoursStart: "09:00", businessHoursEnd: "17:00" }).days.join(",") === DEFAULT_RESPONSE_DAYS.join(","));
check("JSON do portal vence campos legados", normalizeAgentResponseSchedule({ businessHoursOnly: false, businessHoursStart: "08:00", businessHoursEnd: "18:00", automationRules: { response_schedule: { enabled: true, start: "18:00", end: "08:00", days: [7] } } }).start === "18:00");
check("configuração de madrugada mantém timezone do Brasil", normalizeAgentResponseSchedule({ automationRules: { response_schedule: { enabled: true, start: "18:00", end: "08:00", days: [7] } } }).timezone === "America/Sao_Paulo");

console.log(`AGENT_RESPONSE_SCHEDULE: ${passed} OK / ${failed} FALHA`);
if (failed > 0) process.exit(1);
