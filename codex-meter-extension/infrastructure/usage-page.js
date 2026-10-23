(function () {
  "use strict";

  const dateKey = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  };

  // Read the full period label rather than the sparse dates drawn on the chart axis.
  const parseDateRange = (text, locale = "en-US") => {
    const value = String(text || "").replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    let matches = [...value.matchAll(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g)];
    let dates = matches.map((match) => dateKey(+match[1], +match[2], +match[3]));
    if (matches.length !== 2) {
      matches = [...value.matchAll(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g)];
      let monthFirst = true;
      try {
        const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2001, 10, 22));
        monthFirst = parts.findIndex((part) => part.type === "month") < parts.findIndex((part) => part.type === "day");
      } catch {}
      dates = matches.map((match) => dateKey(+match[3], +(monthFirst ? match[1] : match[2]), +(monthFirst ? match[2] : match[1])));
    }
    if (dates.length !== 2) {
      const parts = value.split(/\s*[–—]\s*|\s+-\s+/);
      const sharedYear = Number(value.match(/\b\d{4}\b/g)?.at(-1));
      const normalize = (input) => input.toLocaleLowerCase(locale).normalize("NFKC").replace(/[.\s]/g, "");
      try {
        const monthNames = Array.from({ length: 12 }, (_, month) => ["short", "long"].map((length) => normalize(
          new Intl.DateTimeFormat(locale, { month: length }).format(new Date(2001, month, 15)),
        )));
        const parsed = parts.map((part) => {
          const normalized = normalize(part);
          const month = monthNames.findIndex((names) => names.some((name) => normalized.includes(name))) + 1;
          const day = Number(part.match(/\b\d{1,2}\b/)?.[0]);
          const year = Number(part.match(/\b\d{4}\b/)?.[0]) || sharedYear;
          return { year, month, day, explicitYear: /\b\d{4}\b/.test(part) };
        });
        if (parsed.length === 2) {
          if (!parsed[0].explicitYear && parsed[0].month > parsed[1].month) parsed[0].year -= 1;
          dates = parsed.map((part) => part.year && part.month && part.day ? dateKey(part.year, part.month, part.day) : null);
        }
      } catch {
        return null;
      }
    }
    if (dates.length !== 2 || dates.some((date) => !date) || dates[0] > dates[1]) return null;
    return { startDate: dates[0], endDate: dates[1] };
  };

  const isOwned = (element) => Boolean(element?.closest(
    "#codex-meter-dialog-overlay,#codex-quota-compass-button,#codex-meter-chart-controls,#codex-meter-chart-view,.cqm-usage-toolbar,.cqm-meter-period-label",
  ));

  // Official keyboard selection changes the period label to a single day.
  // Its 1-based slider index still identifies that day within the whole period.
  const rangeFromSelectedDay = (text, index, days, locale = "en-US") => {
    if (![7, 30].includes(days) || !Number.isInteger(index) || index < 1 || index > days) return null;
    const selected = parseDateRange(`${text} – ${text}`, locale);
    if (!selected || selected.startDate !== selected.endDate) return null;
    const start = new Date(`${selected.startDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - index + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
  };

  const findMount = () => {
    const main = document.querySelector("main");
    if (!main) return null;
    // The usage chart has its own 7/30-day group and an accessible slider.
    // Other sections use the same date controls, so neither criterion alone is enough.
    for (const group of main.querySelectorAll("section [role='group']")) {
      if (isOwned(group)) continue;
      const buttons = [...group.children].filter((child) => child.matches("button[aria-pressed]"));
      if (buttons.length !== 2 || ![7, 30].every((days) => buttons.some((button) => Number(button.textContent.match(/\d+/)?.[0]) === days))) continue;
      const section = group.closest("section");
      const slider = section.querySelector("[role='slider']");
      if (!slider) continue;
      const header = section.firstElementChild;
      let chartBody = null;
      for (let candidate = slider.parentElement; candidate && candidate !== section; candidate = candidate.parentElement) {
        const children = [...candidate.children].filter((child) => !isOwned(child));
        if (children.some((child) => child.contains(slider)) && children.some((child) => !child.contains(slider) && child.querySelector("button"))) {
          chartBody = candidate;
          break;
        }
      }
      if (!chartBody || !header || header.contains(group)) continue;
      const frame = [...chartBody.children].find((child) => child.contains(slider));
      const legend = [...chartBody.children].find((child) => child !== frame && !isOwned(child) && child.querySelector("button"));
      const heading = header.firstElementChild?.firstElementChild || header.firstElementChild;
      return { section, header, heading, rangeGroup: group, controlsRow: group.parentElement, chartBody, frame, legend, periodHeader: chartBody.previousElementSibling, slider };
    }
    return null;
  };

  const readDateRange = (locale = document.documentElement.lang || "en-US") => {
    const mount = findMount();
    if (!mount) return null;
    const text = mount.slider.getAttribute("aria-valuetext");
    const originalPeriodText = mount.periodHeader?.querySelector("[data-cqm-source-period]")?.textContent ?? mount.periodHeader?.textContent;
    return parseDateRange(originalPeriodText, locale) || parseDateRange(text, locale) ||
      rangeFromSelectedDay(text, Number(mount.slider.getAttribute("aria-valuenow")), Number(mount.slider.getAttribute("aria-valuemax")), locale);
  };

  const readRangeDays = () => {
    const active = findMount()?.rangeGroup.querySelector("button[aria-pressed='true']");
    return Number(active?.textContent.match(/\d+/)?.[0]) === 30 ? 30 : 7;
  };

  window.CodexMeterUsagePage = { findMount, parseDateRange, rangeFromSelectedDay, readDateRange, readRangeDays };
})();
