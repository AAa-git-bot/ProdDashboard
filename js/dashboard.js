/**
 * ==========================================================================
 * 뉴딜 공장 생산 일자 현황 스크립트 (dashboard.js)
 *
 * [핵심 설계 포인트]
 * 1) 외부 라이브러리 없이 순수 JavaScript만 사용하여 브라우저에서 바로 실행 가능
 * 2) CSV 인코딩 방식이 UTF-8, EUC-KR, CP949 등 서로 달라도 자동으로 보정
 * 3) 데이터의 의미를 파악해 요약 카드, 그래프, 테이블, NG 집계를 함께 렌더링
 * 4) 실제 운영 KPI를 반영한 계산식 사용
 *    - 총 생산 롤 수
 *    - 불량률 (%)
 *    - 가동률 (%)
 *    - 총 로스시간
 *    - 모델별 생산량
 *    - 일자별 로스시간 변화량
 * 5) 그래프는 세로 막대형으로 제공해 빠르게 데이터 편차를 시각화
 * 6) NG 행은 배경색으로 강조되어 불량 원인을 즉시 확인 가능
 * ==========================================================================
 */

// 페이지의 DOM 요소가 모두 로드된 뒤, 필요한 이벤트를 연결하고 각종 렌더링 함수를 실행합니다.
document.addEventListener('DOMContentLoaded', () => {
    // 1) 화면에서 필요한 DOM 요소를 참조합니다.
    const csvFileInput = document.getElementById('csvFileInput');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const emptyState = document.getElementById('emptyState');
    const dashboardMain = document.getElementById('dashboardMain');

    // 요약 카드 영역
    const cardTotalRolls = document.getElementById('cardTotalRolls');
    const cardDefectRate = document.getElementById('cardDefectRate');
    const cardOperationRate = document.getElementById('cardOperationRate');
    const cardTotalLoss = document.getElementById('cardTotalLoss');

    // 차트 컨테이너 영역
    const equipmentChart = document.getElementById('equipmentChart');
    const dateChart = document.getElementById('dateChart');
    const modelChart = document.getElementById('modelChart');
    const lossChangeChart = document.getElementById('lossChangeChart');
    const equipmentTimeChart = document.getElementById('equipmentTimeChart');

    // 테이블 및 NG 요약 영역
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const ngSummaryPanel = document.getElementById('ngSummaryPanel');
    const ngOnlySection = document.getElementById('ngOnlySection');
    const ngTableHead = document.getElementById('ngTableHead');
    const ngTableBody = document.getElementById('ngTableBody');

    /**
     * 파일 선택 이벤트를 처리합니다.
     * 사용자가 CSV 파일을 선택하면 FileReader로 읽어와 파싱 후 대시보드 렌더링을 수행합니다.
     */
    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];

        // 파일 선택이 취소된 경우 아무 동작도 하지 않습니다.
        if (!file) {
            return;
        }

        fileNameDisplay.textContent = file.name;

        // 파일을 ArrayBuffer로 읽어서 인코딩을 보정한 뒤 CSV 문자열로 변환합니다.
        const reader = new FileReader();

        reader.onload = (e) => {
            const buffer = e.target.result;
            let text = '';

            try {
                // UTF-8로 정상 디코딩이 가능한지 우선 확인합니다.
                const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                text = utf8Decoder.decode(buffer);
            } catch (err) {
                // UTF-8이 실패하면 EUC-KR/CP949 형식으로 재시도합니다.
                // 한국 Excel CSV가 기본적으로 CP949/EUC-KR 인코딩을 사용하므로 대응이 필요합니다.
                const eucKrDecoder = new TextDecoder('euc-kr');
                text = eucKrDecoder.decode(buffer);
            }

            parseAndRenderDashboard(text);
        };

        reader.onerror = () => {
            alert('파일을 읽는 중 오류가 발생했습니다.');
        };

        reader.readAsArrayBuffer(file);
    });

    /**
     * CSV 문자열을 파싱하고 전체 대시보드를 렌더링하는 핵심 함수입니다.
     * @param {string} csvText - 디코딩된 CSV 전체 문자열
     */
    function parseAndRenderDashboard(csvText) {
        const parsedData = parseCSV(csvText);

        if (!parsedData || parsedData.length === 0) {
            alert('CSV 파일에 데이터가 없거나 형식이 올바르지 않습니다.');
            return;
        }

        // CSV의 첫 행은 컬럼명으로 사용되며, 이후 행은 실제 생산 데이터입니다.
        const headers = parsedData[0].map(h => h.trim());
        const rows = parsedData.slice(1).filter(row => row.length === headers.length && row.some(cell => cell.trim() !== ''));

        if (rows.length === 0) {
            alert('유효한 데이터 행이 없습니다.');
            return;
        }

        // 헤더와 값 조합을 객체 배열로 변환해 이후 렌더링에서 쉽게 다루도록 합니다.
        const dataObjects = rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] ? row[index].trim() : '';
            });
            return obj;
        });

        const { headers: enrichedHeaders, data: enrichedData } = enrichThicknessDeviationColumn(headers, dataObjects);

        // 화면의 각 영역을 순서대로 업데이트합니다.
        renderSummaryCards(enrichedData, enrichedHeaders);
        renderEquipmentChart(enrichedData, enrichedHeaders);
        renderDateChart(enrichedData, enrichedHeaders);
        renderModelChart(enrichedData, enrichedHeaders);
        renderLossChangeChart(enrichedData, enrichedHeaders);
        renderEquipmentTimeComparisonChart(enrichedData, enrichedHeaders);
        renderNgSummary(enrichedData, enrichedHeaders);
        renderNgOnlyTable(enrichedHeaders, enrichedData);
        renderTable(enrichedHeaders, enrichedData);

        // 빈 상태 안내는 숨기고 실제 대시보드 내용을 활성화합니다.
        emptyState.classList.add('hidden');
        dashboardMain.classList.remove('hidden');
    }

    /**
     * CSV 파싱 전용 함수입니다.
     * 큰따옴표 안의 쉼표와 줄바꿈을 정상적으로 처리하여 표준 CSV를 안전하게 읽어옵니다.
     * @param {string} text
     * @returns {Array<Array<string>>}
     */
    function parseCSV(text) {
        const result = [];
        let row = [];
        let cell = '';
        let inQuotes = false;

        const str = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const nextChar = str[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
            } else if (char === '\n' && !inQuotes) {
                row.push(cell);
                result.push(row);
                row = [];
                cell = '';
            } else {
                cell += char;
            }
        }

        if (cell !== '' || row.length > 0) {
            row.push(cell);
            result.push(row);
        }

        return result;
    }

    /**
     * 헤더명 후보 배열에서 실제 존재하는 컬럼을 찾아 반환합니다.
     * 예: ['설비명', '설비'] 같은 유사 이름이 있어도 폭넓게 대응할 수 있습니다.
     * @param {string[]} headers
     * @param {string[]} candidates
     * @returns {string}
     */
    function findHeader(headers, candidates) {
        const lookup = candidates.map(name => name.toLowerCase());
        const matched = headers.find(header => {
            const normalized = (header || '').trim().toLowerCase();
            return lookup.some(candidate => normalized.includes(candidate));
        });

        return matched || candidates[0];
    }

    /**
     * 두께 편차 열을 추가합니다.
     * 좌/중/우 두께 값의 최댓값과 최솟값 차이를 계산해 소수점 첫째 자리까지 저장합니다.
     * @param {string[]} headers
     * @param {Array<Object>} data
     * @returns {{ headers: string[], data: Array<Object> }}
     */
    function enrichThicknessDeviationColumn(headers, data) {
        const findThicknessHeader = (patterns) => {
            const regexes = patterns.map(pattern => new RegExp(pattern, 'i'));
            return headers.find(header => {
                const normalized = (header || '').trim();
                return regexes.some(regex => regex.test(normalized));
            });
        };

        const leftHeader = findThicknessHeader(['두께[_\s-]?좌', '좌\s*두께', 'left\s*thickness', 'thickness[_\s-]?left']);
        const centerHeader = findThicknessHeader(['두께[_\s-]?중', '중\s*두께', 'center\s*thickness', 'thickness[_\s-]?center']);
        const rightHeader = findThicknessHeader(['두께[_\s-]?우', '우\s*두께', 'right\s*thickness', 'thickness[_\s-]?right']);

        if (!leftHeader || !centerHeader || !rightHeader) {
            return { headers, data };
        }

        const deviationHeader = '두께 편차';
        const existingIndex = headers.findIndex(header => /두께\s*편차|thickness\s*deviation/i.test(header || ''));
        const nextHeaders = [...headers];

        if (existingIndex === -1) {
            const insertionIndex = Math.max(
                headers.findIndex(header => header === rightHeader),
                headers.findIndex(header => header === centerHeader),
                headers.findIndex(header => header === leftHeader)
            ) + 1;
            nextHeaders.splice(insertionIndex, 0, deviationHeader);
        } else {
            nextHeaders[existingIndex] = deviationHeader;
        }

        const normalizedData = data.map(item => ({ ...item }));

        normalizedData.forEach(item => {
            const values = [
                toNumber(item[leftHeader]),
                toNumber(item[centerHeader]),
                toNumber(item[rightHeader]),
            ];
            const deviation = values.length ? Math.max(...values) - Math.min(...values) : 0;
            item[deviationHeader] = Number(deviation.toFixed(1)).toString();
        });

        return { headers: nextHeaders, data: normalizedData };
    }

    /**
     * 문자열을 숫자로 안전하게 변환합니다.
     * 숫자가 아닌 값은 0을 반환하여 그래프/합계 계산이 깨지지 않도록 보장합니다.
     * @param {string|number} value
     * @returns {number}
     */
    function toNumber(value) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    /**
     * 공통 세로 막대 그래프 렌더링 함수입니다.
     * 동일한 스타일을 여러 차트에서 재사용할 수 있도록 범용화하였습니다.
     * @param {HTMLElement} container
     * @param {Array<{label:string, value:number, meta?:string}>} items
     * @param {Object} options
     */
    function renderVerticalBarChart(container, items, options = {}) {
        if (!container) {
            return;
        }

        container.innerHTML = '';

        if (!items || items.length === 0) {
            container.innerHTML = '<div class="empty-chart">데이터가 없습니다.</div>';
            return;
        }

        const defaultOptions = {
            barColor: '#2563eb',
            valueFormatter: (value) => `${value}`,
            labelFormatter: (label) => label,
            itemClassName: '',
            positiveClass: 'positive',
            negativeClass: 'negative',
            isDeltaChart: false,
        };

        const config = { ...defaultOptions, ...options };
        const maxValue = Math.max(...items.map(item => Math.abs(item.value || 0)), 1);

        items.forEach((item) => {
            const chartItem = document.createElement('div');
            chartItem.className = `bar-chart-item ${config.itemClassName}`.trim();

            const barFillClass = config.isDeltaChart
                ? (item.value >= 0 ? config.positiveClass : config.negativeClass)
                : '';

            const fillHeight = Math.max(8, (Math.abs(item.value || 0) / maxValue) * 100);

            chartItem.innerHTML = `
                <div class="bar-chart-value">${config.valueFormatter(item.value)}</div>
                <div class="bar-chart-track">
                    <div class="bar-chart-fill ${barFillClass}" style="height: ${fillHeight}%; background: ${config.barColor};"></div>
                </div>
                <div class="bar-chart-label" title="${item.label}">${config.labelFormatter(item.label)}</div>
            `;

            container.appendChild(chartItem);
        });
    }

    /**
     * [영역 1] 요약 카드 계산 및 표시 함수
     * - 총 생산 롤 수
     * - 불량률 (%) = NG 건수 / 전체 건수 * 100
     * - 가동률 (%) = 생산시간 / (생산시간 + 로스시간) * 100
     * - 총 로스시간 (분)
     */
    function renderSummaryCards(data, headers) {
        const totalRolls = data.length;
        const resultHeader = findHeader(headers, ['판정', '결과', '검사판정']);
        const prodTimeHeader = findHeader(headers, ['생산시간', '생산시간_분']);
        const lossTimeHeader = findHeader(headers, ['로스시간', '로스시간_분']);

        const ngCount = data.filter(item => {
            const val = (item[resultHeader] || '').toUpperCase();
            return val === 'NG';
        }).length;

        const defectRate = totalRolls > 0 ? (ngCount / totalRolls) * 100 : 0;

        let sumProdTime = 0;
        let sumLossTime = 0;

        data.forEach(item => {
            sumProdTime += toNumber(item[prodTimeHeader]);
            sumLossTime += toNumber(item[lossTimeHeader]);
        });

        const totalTime = sumProdTime + sumLossTime;
        const operationRate = totalTime > 0 ? (sumProdTime / totalTime) * 100 : 0;

        cardTotalRolls.textContent = totalRolls.toLocaleString();
        cardDefectRate.textContent = defectRate.toFixed(1);
        cardOperationRate.textContent = operationRate.toFixed(1);
        cardTotalLoss.textContent = sumLossTime.toFixed(1);
    }

    /**
     * [영역 2-1] 설비별 생산 롤 수를 세로 막대 그래프로 표현합니다.
     * 많은 생산량을 보유한 설비가 그래프에서 더 크게 표시됩니다.
     */
    function renderEquipmentChart(data, headers) {
        const equipHeader = findHeader(headers, ['설비명', '설비']);
        const counts = {};

        data.forEach(item => {
            const equip = item[equipHeader] || '미지정';
            counts[equip] = (counts[equip] || 0) + 1;
        });

        const sortedEquip = Object.keys(counts)
            .map(key => ({ label: key, value: counts[key] }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

        renderVerticalBarChart(equipmentChart, sortedEquip, {
            barColor: '#3b82f6',
            valueFormatter: (value) => `${value}롤`,
            labelFormatter: (label) => label,
        });
    }

    /**
     * [영역 2-2] 일자별 생산 롤 수를 세로 막대 그래프로 표현합니다.
     * 기존 가로형 차트보다 한 번에 날짜별 증감을 이해하기 쉽습니다.
     */
    function renderDateChart(data, headers) {
        const dateHeader = findHeader(headers, ['생산일자', '일자', '날짜']);
        const counts = {};

        data.forEach(item => {
            const date = item[dateHeader] || '미지정';
            counts[date] = (counts[date] || 0) + 1;
        });

        const sortedDates = Object.keys(counts)
            .map(key => ({ label: key, value: counts[key] }))
            .sort((a, b) => a.label.localeCompare(b.label));

        renderVerticalBarChart(dateChart, sortedDates, {
            barColor: '#0d9488',
            valueFormatter: (value) => `${value}롤`,
            labelFormatter: (label) => label.replace(/-\d{2}$/, '').replace(/\d{4}-/g, ''),
        });
    }

    /**
     * [영역 2-3] 생산 모델별 생산 롤 수 차트를 추가합니다.
     * 모델별 생산 편중 여부를 빠르게 판단할 수 있도록 구성합니다.
     */
    function renderModelChart(data, headers) {
        const modelHeader = findHeader(headers, ['생산모델', '모델', '제품모델']);
        const counts = {};

        data.forEach(item => {
            const model = item[modelHeader] || '미지정';
            counts[model] = (counts[model] || 0) + 1;
        });

        const sortedModels = Object.keys(counts)
            .map(key => ({ label: key, value: counts[key] }))
            .sort((a, b) => b.value - a.value);

        renderVerticalBarChart(modelChart, sortedModels, {
            barColor: '#8b5cf6',
            valueFormatter: (value) => `${value}롤`,
            labelFormatter: (label) => label.length > 12 ? label.slice(0, 12) + '…' : label,
        });
    }

    /**
     * [영역 2-4] 생산별 로스시간 변화량 차트를 추가합니다.
     * 전일 대비 로스시간 변화량을 계산해 하루 단위로 증감을 파악합니다.
     */
    function renderLossChangeChart(data, headers) {
        const dateHeader = findHeader(headers, ['생산일자', '일자', '날짜']);
        const lossHeader = findHeader(headers, ['로스시간', '로스시간_분']);

        const dailyLoss = {};

        data.forEach(item => {
            const date = item[dateHeader] || '미지정';
            dailyLoss[date] = (dailyLoss[date] || 0) + toNumber(item[lossHeader]);
        });

        const sortedDates = Object.keys(dailyLoss)
            .sort((a, b) => a.localeCompare(b))
            .map(date => ({ label: date, value: dailyLoss[date] }));

        const withDelta = sortedDates.map((item, index) => {
            const previousValue = index > 0 ? sortedDates[index - 1].value : item.value;
            return {
                label: item.label,
                value: item.value - previousValue,
            };
        });

        renderVerticalBarChart(lossChangeChart, withDelta, {
            barColor: '#f59e0b',
            valueFormatter: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}분`,
            labelFormatter: (label) => label.replace(/-\d{2}$/, '').replace(/\d{4}-/g, ''),
            isDeltaChart: true,
            positiveClass: 'positive',
            negativeClass: 'negative',
        });
    }

    /**
     * 설비별 생산시간과 로스시간을 비교하는 세로 막대 그래프를 렌더링합니다.
     * 같은 설비에서 생산시간과 로스시간이 얼마나 차이나는지를 한 번에 파악할 수 있습니다.
     * @param {Array<Object>} data
     * @param {string[]} headers
     */
    function renderEquipmentTimeComparisonChart(data, headers) {
        const equipHeader = findHeader(headers, ['설비명', '설비']);
        const prodTimeHeader = findHeader(headers, ['생산시간', '생산시간_분']);
        const lossTimeHeader = findHeader(headers, ['로스시간', '로스시간_분']);

        const grouped = {};

        data.forEach(item => {
            const equip = item[equipHeader] || '미지정';
            if (!grouped[equip]) {
                grouped[equip] = { prod: 0, loss: 0 };
            }
            grouped[equip].prod += toNumber(item[prodTimeHeader]);
            grouped[equip].loss += toNumber(item[lossTimeHeader]);
        });

        const equipmentItems = Object.keys(grouped)
            .map(key => ({
                label: key,
                production: grouped[key].prod,
                loss: grouped[key].loss,
            }))
            .sort((a, b) => (b.production + b.loss) - (a.production + a.loss));

        equipmentTimeChart.innerHTML = '';

        if (!equipmentItems.length) {
            equipmentTimeChart.innerHTML = '<div class="empty-chart">데이터가 없습니다.</div>';
            return;
        }

        const maxValue = Math.max(...equipmentItems.flatMap(item => [item.production, item.loss]), 1);
        const axisBandWidth = 180;

        equipmentItems.forEach((item) => {
            const group = document.createElement('div');
            group.className = 'equipment-time-group';

            const productionHeight = Math.max(10, (item.production / maxValue) * 100);
            const lossHeight = Math.max(10, (item.loss / maxValue) * 100);

            group.innerHTML = `
                <div class="equipment-time-bars">
                    <div class="equipment-bar-wrap">
                        <div class="equipment-bar-value">${item.production.toFixed(1)}분</div>
                        <div class="equipment-bar-track" style="height: ${axisBandWidth}px;">
                            <div class="equipment-bar production-fill" style="height: ${productionHeight}%"></div>
                        </div>
                    </div>
                    <div class="equipment-bar-wrap">
                        <div class="equipment-bar-value">${item.loss.toFixed(1)}분</div>
                        <div class="equipment-bar-track" style="height: ${axisBandWidth}px;">
                            <div class="equipment-bar loss-fill" style="height: ${lossHeight}%"></div>
                        </div>
                    </div>
                </div>
                <div class="equipment-time-label" title="${item.label}">${item.label}</div>
            `;

            equipmentTimeChart.appendChild(group);
        });
    }

    /**
     * NG 항목 간략 요약 카드 패널을 렌더링합니다.
     * Data 섹션 상단에 표시되어 NG 총량, 비율, 주요 모델 정보를 한눈에 확인할 수 있습니다.
     * @param {Array<Object>} data
     * @param {string[]} headers
     */
    function renderNgSummary(data, headers) {
        const resultHeader = findHeader(headers, ['판정', '결과', '검사판정']);
        const modelHeader = findHeader(headers, ['생산모델', '모델', '제품모델']);

        const total = data.length;
        const ngCount = data.filter(item => (item[resultHeader] || '').trim().toUpperCase() === 'NG').length;
        const okCount = total - ngCount;
        const ngRate = total > 0 ? (ngCount / total) * 100 : 0;

        const modelCounts = {};
        data.forEach(item => {
            const model = item[modelHeader] || '미지정';
            if ((item[resultHeader] || '').trim().toUpperCase() === 'NG') {
                modelCounts[model] = (modelCounts[model] || 0) + 1;
            }
        });

        const topNgModel = Object.entries(modelCounts)
            .sort((a, b) => b[1] - a[1])[0];

        const topNgText = topNgModel ? `${topNgModel[0]} (${topNgModel[1]}건)` : '없음';

        ngSummaryPanel.innerHTML = `
            <div class="summary-chip">
                <span class="chip-label">NG 건수</span>
                <strong>${ngCount}</strong>
            </div>
            <div class="summary-chip">
                <span class="chip-label">OK 건수</span>
                <strong>${okCount}</strong>
            </div>
            <div class="summary-chip">
                <span class="chip-label">NG 비율</span>
                <strong>${ngRate.toFixed(1)}%</strong>
            </div>
            <div class="summary-chip summary-chip-wide">
                <span class="chip-label">주요 NG 모델</span>
                <strong>${topNgText}</strong>
            </div>
        `;
    }

    /**
     * NG 항목만 별도 테이블로 모아 보여주는 함수입니다.
     * 전체 데이터의 맨 위에 배치해 불량 원인과 건수를 빠르게 확인할 수 있습니다.
     * @param {string[]} headers
     * @param {Array<Object>} data
     */
    function renderNgOnlyTable(headers, data) {
        const resultHeader = findHeader(headers, ['판정', '결과', '검사판정']);
        const ngRows = data.filter(item => (item[resultHeader] || '').trim().toUpperCase() === 'NG');

        ngOnlySection.classList.toggle('hidden', ngRows.length === 0);

        ngTableHead.innerHTML = '';
        const headRow = document.createElement('tr');
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headRow.appendChild(th);
        });
        ngTableHead.appendChild(headRow);

        ngTableBody.innerHTML = '';
        ngRows.forEach(rowObject => {
            const tr = document.createElement('tr');
            tr.classList.add('row-ng');

            headers.forEach(header => {
                const td = document.createElement('td');
                const val = rowObject[header];

                if (header === resultHeader) {
                    td.innerHTML = `<span class="badge-ng">${val}</span>`;
                } else {
                    td.textContent = val;
                }

                tr.appendChild(td);
            });

            ngTableBody.appendChild(tr);
        });
    }

    /**
     * [영역 3] 전체 데이터 테이블 렌더링 함수입니다.
     * 판정이 NG인 행은 class를 추가해 붉은 배경으로 강조하고, OK는 초록 뱃지로 표시합니다.
     * @param {string[]} headers
     * @param {Array<Object>} data
     */
    function renderTable(headers, data) {
        const resultHeader = findHeader(headers, ['판정', '결과', '검사판정']);

        tableHead.innerHTML = '';
        const headRow = document.createElement('tr');
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headRow.appendChild(th);
        });
        tableHead.appendChild(headRow);

        tableBody.innerHTML = '';
        data.forEach(rowObject => {
            const tr = document.createElement('tr');
            const resultVal = (rowObject[resultHeader] || '').trim().toUpperCase();

            if (resultVal === 'NG') {
                tr.classList.add('row-ng');
            }

            headers.forEach(header => {
                const td = document.createElement('td');
                const val = rowObject[header];

                if (header === resultHeader) {
                    if (resultVal === 'NG') {
                        td.innerHTML = `<span class="badge-ng">${val}</span>`;
                    } else if (resultVal === 'OK') {
                        td.innerHTML = `<span class="badge-ok">${val}</span>`;
                    } else {
                        td.textContent = val;
                    }
                } else {
                    td.textContent = val;
                }

                tr.appendChild(td);
            });

            tableBody.appendChild(tr);
        });
    }
});
