/**
 * Apple Dynamic Island & Gemini AI Copilot Controller for EnergiOS.
 * Connects directly to backend /chat endpoint with live telemetry grounding.
 */
class DynamicIslandController {
  constructor() {
    this.isExpanded = false;
    this.history = [];
    this.isThinking = false;
  }

  init() {
    document.addEventListener('click', (event) => {
      const island = document.getElementById('dynamic-island');
      if (this.isExpanded && island && !island.contains(event.target)) {
        this.collapse();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isExpanded) {
        this.collapse();
      }
    });
  }

  expand() {
    const collapsed = document.getElementById('island-collapsed');
    const expanded = document.getElementById('island-expanded');
    if (!collapsed || !expanded) return;
    this.isExpanded = true;
    collapsed.classList.add('hidden');
    expanded.classList.remove('hidden');

    const input = document.getElementById('island-user-input');
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  collapse() {
    const collapsed = document.getElementById('island-collapsed');
    const expanded = document.getElementById('island-expanded');
    if (!collapsed || !expanded) return;
    this.isExpanded = false;
    expanded.classList.add('hidden');
    collapsed.classList.remove('hidden');
  }

  formatTime() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  }

  addLog(message, isSuccess = false, isWarning = false) {
    const logsList = document.getElementById('island-agent-logs-list');
    if (!logsList) return;

    const row = document.createElement('div');
    row.className = 'flex items-start gap-1.5 leading-snug';

    let iconHtml = '<span class="text-neutral-500 whitespace-nowrap">• ' + this.formatTime() + ' —</span>';
    let textClass = 'text-neutral-300';
    if (isSuccess) textClass = 'text-emerald-400 font-medium';
    if (isWarning) textClass = 'text-amber-400 font-medium';

    row.innerHTML = `
      ${iconHtml}
      <span class="${textClass}">${this.escapeHtml(message)}</span>
    `;

    logsList.appendChild(row);
    logsList.scrollTop = logsList.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);

    // Bold: **text** -> <b>text</b>
    html = html.replace(/\*\*(.*?)\*\*/g, '<b class="font-bold text-white">$1</b>');
    // Italic: *text* -> <i>text</i>
    html = html.replace(/\*(.*?)\*/g, '<i class="text-neutral-300">$1</i>');
    // Bullet lists: - item -> • item
    html = html.replace(/^\s*[-•]\s+(.*)$/gm, '<div class="pl-2.5 py-0.5 flex items-start gap-1.5"><span class="text-[#FF7A00]">•</span><span>$1</span></div>');
    // Line breaks
    html = html.replace(/\n\n/g, '<div class="my-2"></div>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  getActiveBuildingId() {
    if (window.veloraApp && window.veloraApp.activeBuilding) {
      return window.veloraApp.activeBuilding;
    }
    if (window.diagApp && window.diagApp.activeBuilding) {
      return window.diagApp.activeBuilding;
    }
    if (window.energyApp && window.energyApp.activeBuilding) {
      return window.energyApp.activeBuilding;
    }
    if (window.twinApp && window.twinApp.activeBuilding) {
      return window.twinApp.activeBuilding;
    }
    return 'Hog_office_Bill';
  }

  async sendQuickPrompt(promptText) {
    const input = document.getElementById('island-user-input');
    if (input) {
      input.value = promptText;
    }
    await this.handleUserSubmit(new Event('submit'));
  }

  async handleUserSubmit(event) {
    if (event && event.preventDefault) {
      event.preventDefault();
    }

    if (this.isThinking) return;

    const input = document.getElementById('island-user-input');
    if (!input) return;

    const userQuery = input.value.trim();
    if (!userQuery) return;

    input.value = '';

    if (!this.isExpanded) {
      this.expand();
    }

    const bubble = document.getElementById('island-agent-bubble-text');
    const activeBuilding = this.getActiveBuildingId();

    this.addLog(`User query: "${userQuery}"`);

    // Set thinking indicator
    this.isThinking = true;
    if (bubble) {
      bubble.innerHTML = `
        <div class="flex items-center gap-2 py-1 text-neutral-300">
          <span class="w-2 h-2 rounded-full bg-[#FF7A00] animate-ping"></span>
          <span class="font-medium font-sans">EnergiOS AI is analyzing telemetry with Gemini 2.5 Flash...</span>
        </div>
      `;
    }

    try {
      let data = null;
      if (/solar|grid|battery|dispatch|switch|power source|energy source/i.test(userQuery)) {
        const approved = window.dispatchPlans?.forAsset(activeBuilding);
        const card = window.dispatchPlans?.read().cards.slice().reverse().find(item => item.result.asset_id === activeBuilding);
        const plan = approved || card;
        if (!plan) throw new Error('No engine decision is available for this building. Calculate a scenario in the Township AI panel first.');
        const explanation = await window.apiClient.explainSolarGrid(plan.result.recommendation_id, plan.transition.id);
        data = { response: `${explanation.label}\n\n${explanation.explanation}\n\n${explanation.method}\n\nSources: BDG2 https://doi.org/10.5281/zenodo.3887306; Open-Meteo https://open-meteo.com/en/docs` };
      } else if (window.apiClient && typeof window.apiClient.chat === 'function') {
        data = await window.apiClient.chat(userQuery, activeBuilding, this.history);
      } else {
        const baseUrl = (window.apiClient && window.apiClient.getBaseUrl()) || 'http://127.0.0.1:8000';
        const response = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userQuery,
            building_id: activeBuilding,
            history: this.history,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }

      if (data && data.response) {
        if (bubble) {
          bubble.innerHTML = this.formatMarkdown(data.response);
        }

        // Append logs
        if (Array.isArray(data.agent_logs)) {
          data.agent_logs.forEach((logText) => {
            const clean = logText.replace(/^[•\s\d:-]+—\s*/, '');
            if (clean) {
              const isSuccess = logText.includes('✅') || logText.includes('completed');
              this.addLog(clean, isSuccess);
            }
          });
        }

        // Save history
        this.history.push({ role: 'user', content: userQuery });
        this.history.push({ role: 'model', content: data.response });
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (error) {
      console.warn('Gemini chat request fallback:', error);
      if (bubble) {
        bubble.innerHTML = `
          <div class="space-y-1.5">
            <p><b>Assistant unavailable:</b> ${this.escapeHtml(error.message || 'Please retry.')}</p>
            <p class="text-[10px] text-neutral-400">Calculated engine reasons remain available in the Township AI panel. No plan has been applied by this request.</p>
          </div>
        `;
      }
      this.addLog(`AI Reasoning note: ${error.message || 'Served local benchmark telemetry'}`, false, true);
    } finally {
      this.isThinking = false;
      if (input) input.focus();
    }
  }
}

window.dynamicIsland = new DynamicIslandController();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.dynamicIsland.init());
} else {
  window.dynamicIsland.init();
}
