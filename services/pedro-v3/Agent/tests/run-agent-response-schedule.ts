import {
  DEFAULT_RESPONSE_DAYS,
  isWithinAgentResponseSchedule,
  normalizeAgentResponseSchedule,
} from "../src/domain/agent-response-schedule.ts";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) { passed += 1; console.log(`OK ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}`); }
}

const overnightSunday = normalizeAgentResponseSchedule({
  automationRules: { response_schedule: { enabled: true, start: "18:00", end: "08:00", days: [7] } },
});
check("desligado deixa responder sempre", isWithinAgentResponseSchedule("2026-07-19T03:00:00Z", { ...overnightSunday, enabled: false }));
check("domingo 18h inicia janela noturna", isWithinAgentResponseSchedule("2026-07-19T21:00:00Z", overnightSunday));
check("segunda 07:59 pertence à janela iniciada domingo", isWithinAgentResponseSchedule("2026-07-20T10:59:00Z", overnightSunday));
check("segunda 08h encerra janela noturna", !isWithinAgentResponseSchedule("2026-07-20T11:00:00Z", overnightSunday));
check("segunda 18h não é incluída quando só domingo foi marcado", !isWithinAgentResponseSchedule("2026-07-20T21:00:00Z", overnightSunday));
const businessHours = normalizeAgentResponseSchedule({
  automationRules: { response_schedule: { enabled: true, start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] } },
});
check("janela normal respeita o dia selecionado", isWithinAgentResponseSchedule("2026-07-20T15:00:00Z", businessHours));
check("domingo fica fechado na janela seg-sáb", !isWithinAgentResponseSchedule("2026-07-19T15:00:00Z", businessHours));
const normalizedLegacy = normalizeAgentResponseSchedule({ businessHoursOnly: true, businessHoursStart: "09:00", businessHoursEnd: "17:00" });
check("normalização usa dias padrão para agente antigo", normalizedLegacy.weekly.filter((day) => day.windows.length > 0).map((day) => day.weekday).join(",") === DEFAULT_RESPONSE_DAYS.join(","));
check("JSON legado do portal vence campos legados", isWithinAgentResponseSchedule("2026-07-20T22:00:00Z", normalizeAgentResponseSchedule({ businessHoursOnly: false, businessHoursStart: "08:00", businessHoursEnd: "18:00", automationRules: { response_schedule: { enabled: true, start: "18:00", end: "08:00", days: [1] } } })));
check("configuração de madrugada mantém timezone do Brasil", normalizeAgentResponseSchedule({ automationRules: { response_schedule: { enabled: true, start: "18:00", end: "08:00", days: [7] } } }).timezone === "America/Sao_Paulo");

const weeklyV2 = normalizeAgentResponseSchedule({
  automationRules: {
    response_schedule: {
      version: 2,
      enabled: true,
      timezone: "America/Sao_Paulo",
      weekly: [
        { day: 1, mode: "custom", windows: [{ start: "00:00", end: "08:30" }, { start: "17:00", end: "24:00" }] },
        { day: 6, mode: "all_day", windows: [{ start: "00:00", end: "24:00" }] },
        { day: 7, mode: "closed", windows: [] },
      ],
    },
  },
});
check("V2 permite duas janelas independentes no mesmo dia", isWithinAgentResponseSchedule("2026-07-20T10:00:00Z", weeklyV2) && isWithinAgentResponseSchedule("2026-07-20T23:00:00Z", weeklyV2));
check("V2 fecha o intervalo entre as duas janelas", !isWithinAgentResponseSchedule("2026-07-20T15:00:00Z", weeklyV2));
check("V2 permite sábado inteiro", isWithinAgentResponseSchedule("2026-07-25T15:00:00Z", weeklyV2) && isWithinAgentResponseSchedule("2026-07-26T02:59:00Z", weeklyV2));
check("V2 mantém domingo fechado", !isWithinAgentResponseSchedule("2026-07-26T15:00:00Z", weeklyV2));
check("V2 malformado falha fechado", !isWithinAgentResponseSchedule("2026-07-20T15:00:00Z", normalizeAgentResponseSchedule({ automationRules: { response_schedule: { version: 2, enabled: true, weekly: [{ day: 1, mode: "custom", windows: [{ start: "18:00", end: "08:00" }] }] } } })));

console.log(`AGENT_RESPONSE_SCHEDULE: ${passed} OK / ${failed} FALHA`);
if (failed > 0) process.exit(1);
