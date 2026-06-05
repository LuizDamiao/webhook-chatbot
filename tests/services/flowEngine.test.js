import { flowEngine } from '../../src/services/flowEngine.js';

describe('FlowEngine', () => {
  beforeEach(() => {
    flowEngine.reset();
  });

  describe('getConversationState', () => {
    it('should create new state with attention phase for unknown phone', () => {
      const state = flowEngine.getConversationState('5511999999999');
      expect(state.phase).toBe('attention');
      expect(state.messageCount).toBe(0);
      expect(state.persuasionUsed).toEqual([]);
    });

    it('should return existing state for known phone', () => {
      flowEngine.advancePhase('5511999999999', 'interest');
      const state = flowEngine.getConversationState('5511999999999');
      expect(state.phase).toBe('interest');
    });
  });

  describe('advancePhase', () => {
    it('should update phase to valid phase', () => {
      const state = flowEngine.advancePhase('5511999999999', 'interest');
      expect(state.phase).toBe('interest');
      expect(state.lastPhaseChange).toBeDefined();
    });

    it('should throw for invalid phase', () => {
      expect(() => flowEngine.advancePhase('5511999999999', 'invalid')).toThrow('Invalid phase');
    });
  });

  describe('identifyPhase', () => {
    it('should move from attention to interest on problem keywords', () => {
      const state = { phase: 'attention' };
      const result = flowEngine.identifyPhase('Minha perna dói muito', state);
      expect(result).toBe('interest');
    });

    it('should stay in attention on greeting', () => {
      const state = { phase: 'attention' };
      const result = flowEngine.identifyPhase('Olá, tudo bem?', state);
      expect(result).toBe('attention');
    });

    it('should move from interest to desire on engagement keywords', () => {
      const state = { phase: 'interest' };
      const result = flowEngine.identifyPhase('Como funciona esse produto?', state);
      expect(result).toBe('desire');
    });

    it('should move from desire to action on purchase keywords', () => {
      const state = { phase: 'desire' };
      const result = flowEngine.identifyPhase('Quero comprar, quanto custa?', state);
      expect(result).toBe('action');
    });

    it('should go back from action to desire on hesitation', () => {
      const state = { phase: 'action' };
      const result = flowEngine.identifyPhase('Não sei, vou pensar', state);
      expect(result).toBe('desire');
    });

    it('should stay in desire on hesitation', () => {
      const state = { phase: 'desire' };
      const result = flowEngine.identifyPhase('Talvez eu compre', state);
      expect(result).toBe('desire');
    });
  });

  describe('getActiveRules', () => {
    it('should return all active rules', () => {
      const rules = flowEngine.getActiveRules();
      expect(rules.length).toBeGreaterThanOrEqual(4);
      expect(rules.every(r => r.isActive === 1)).toBe(true);
    });
  });

  describe('addRule', () => {
    it('should add a new rule', () => {
      const rule = flowEngine.addRule('attention', ['test'], 'template', ['affinity']);
      expect(rule.id).toBeDefined();
      expect(rule.phase).toBe('attention');
    });
  });

  describe('updateRule', () => {
    it('should update an existing rule', () => {
      const rule = flowEngine.addRule('attention', ['test'], 'template', ['affinity']);
      const updated = flowEngine.updateRule(rule.id, { response_template: 'updated' });
      expect(updated.response_template).toBe('updated');
    });
  });

  describe('deleteRule', () => {
    it('should delete a rule', () => {
      const rule = flowEngine.addRule('attention', ['test'], 'template', ['affinity']);
      flowEngine.deleteRule(rule.id);
      const rules = flowEngine.getActiveRules();
      expect(rules.find(r => r.id === rule.id)).toBeUndefined();
    });
  });

  describe('trackPersuasion', () => {
    it('should record persuasion technique', () => {
      flowEngine.trackPersuasion('5511999999999', 'affinity');
      const state = flowEngine.getConversationState('5511999999999');
      expect(state.persuasionUsed).toContain('affinity');
    });

    it('should not repeat same technique', () => {
      flowEngine.trackPersuasion('5511999999999', 'affinity');
      flowEngine.trackPersuasion('5511999999999', 'affinity');
      const state = flowEngine.getConversationState('5511999999999');
      expect(state.persuasionUsed.filter(t => t === 'affinity').length).toBe(1);
    });
  });

  describe('getPersuasionSuggestions', () => {
    it('should return unused techniques for phase', () => {
      const suggestions = flowEngine.getPersuasionSuggestions('attention', []);
      expect(suggestions).toContain('affinity');
      expect(suggestions).toContain('commitment');
    });

    it('should exclude used techniques', () => {
      const suggestions = flowEngine.getPersuasionSuggestions('attention', ['affinity']);
      expect(suggestions).not.toContain('affinity');
      expect(suggestions).toContain('commitment');
    });
  });
});
