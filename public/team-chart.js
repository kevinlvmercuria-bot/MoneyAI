'use strict';

const TEAM_CHART_STAGES = [
    ['assigned', '已分派'], ['contacted', '已联系'], ['replied', '有回复'],
    ['booked', '已预约'], ['visited', '已到店'],
];

function teamChartTaskGroups(tasks) {
    const recorded = tasks.filter(task => task.status === 'recorded' && task.result);
    const contacted = recorded.filter(task => task.result.contacted);
    const booked = contacted.filter(task => task.result.booked);
    return {
        assigned: tasks,
        contacted,
        replied: contacted.filter(task => ['有意向', '已预约', '已沟通', '不再营销'].includes(task.result.outcome)),
        booked,
        visited: booked.filter(task => task.result.appointment_status === 'visited'),
        unanswered: contacted.filter(task => task.result.outcome === '未回复'),
    };
}

function teamChartStages(tasks) {
    const groups = teamChartTaskGroups(tasks);
    return TEAM_CHART_STAGES.map(([key, label]) => [label, groups[key].length]);
}

function teamResultChart(tasks, selected = 'booked') {
    const groups = teamChartTaskGroups(tasks);
    const stages = TEAM_CHART_STAGES.map(([key, label]) => [key, label, groups[key].length]);
    const maximum = Math.max(1, ...stages.map(([, , count]) => count));
    const approximateStep = Math.max(1, maximum / 4);
    const magnitude = 10 ** Math.floor(Math.log10(approximateStep));
    const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= approximateStep);
    const axisMaximum = Math.ceil(maximum / step) * step;
    const ticks = Array.from({ length: axisMaximum / step + 1 }, (_, index) => index * step);
    const hasResults = tasks.length > 0;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return `<section class="team-chart" aria-labelledby="team-chart-title" data-has-results="${hasResults}">
        <header class="team-chart-heading"><h3 id="team-chart-title">从分派到到店</h3><button type="button" class="team-chart-replay" data-replay-team-chart ${hasResults && !reduced ? '' : 'disabled'} aria-label="重播柱状图动效">↻ 重播动效</button></header>
        <figure class="team-chart-figure" aria-label="联系进度柱状图">
            <div class="team-chart-unit" aria-hidden="true">任务数（条）</div>
            <div class="team-chart-canvas">
                <div class="team-chart-axis" aria-hidden="true">${ticks.map(tick => `<span style="bottom:${tick / axisMaximum * 100}%">${tick}</span>`).join('')}</div>
                <div class="team-chart-plot"><div class="team-chart-grid" aria-hidden="true">${ticks.map(tick => `<span style="bottom:${tick / axisMaximum * 100}%"></span>`).join('')}</div>
                    <div class="team-chart-columns">${stages.map(([key, label, count], index) => `
                        <button type="button" class="team-chart-column" data-report-stage="${key}" aria-controls="report-stage-details" aria-pressed="${selected === key}" aria-label="${label} ${count} 条">
                            <span class="team-chart-bar" aria-hidden="true" data-value="${count}" style="--bar-height:${(count / axisMaximum * 100).toFixed(4)}%;--bar-index:${index}"><span class="team-chart-value">${count}</span></span>
                            <span class="team-chart-label" aria-hidden="true">${label}</span>
                        </button>`).join('')}</div>
                </div>
            </div>
        </figure>
        <div class="team-chart-footer"><p class="team-chart-caption">选择柱子查看顾客明细。预约和到店按员工登记分别统计。</p><button type="button" class="team-chart-unanswered" data-report-stage="unanswered" aria-controls="report-stage-details" aria-pressed="${selected === 'unanswered'}">未回复 <strong>${groups.unanswered.length}</strong></button></div>
    </section>`;
}

let teamChartObserver = null;
function cleanupReportChart() {
    teamChartObserver?.disconnect();
    teamChartObserver = null;
}
function replayReportChart() {
    const chart = document.querySelector('.team-chart');
    if (!chart || chart.dataset.hasResults !== 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    chart.classList.remove('is-animating');
    void chart.offsetWidth;
    chart.classList.add('is-animating');
}
function mountReportChart() {
    cleanupReportChart();
    const chart = document.querySelector('.team-chart');
    if (!chart || chart.dataset.hasResults !== 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return replayReportChart();
    teamChartObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
            cleanupReportChart();
            replayReportChart();
        }
    }, { threshold: 0.2 });
    teamChartObserver.observe(chart);
}

if (typeof module !== 'undefined') module.exports = { teamChartStages, teamChartTaskGroups, teamResultChart };
