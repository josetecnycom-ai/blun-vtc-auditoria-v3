// rule-manager.js
// Responsable de buscar y cachear la regla de auditoría (Ej: Parada Rápida)

const RuleManager = (function() {
    let ruleIdParadaRapida = null;
    const RULE_NAME = "Parada Rápida"; // Literal exacto confirmado por el usuario

    return {
        init: async function() {
            try {
                const rules = await DataManager.getRules();
                // Buscar regla por nombre
                const rule = rules.find(r => r.name === RULE_NAME);
                
                if (rule) {
                    ruleIdParadaRapida = rule.id;
                    console.log(`[RuleManager] Regla encontrada: "${RULE_NAME}" (ID: ${ruleIdParadaRapida})`);
                } else {
                    console.warn(`[RuleManager] ATENCIÓN: No se encontró la regla "${RULE_NAME}" en MyGeotab.`);
                }
            } catch (e) {
                console.error("[RuleManager] Error al inicializar reglas", e);
            }
        },

        getParadaRapidaId: function() {
            return ruleIdParadaRapida;
        },

        hasParadaRapidaRule: function() {
            return ruleIdParadaRapida !== null;
        }
    };
})();
