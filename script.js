// webapp/script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ ---
    const API_BASE_URL = "https://mighty-sloths-melt.loca.lt"; // !!! ЗАМЕНИТЕ НА ВАШ АДРЕС ОТ LOCALTUNNEL !!!
    const CALENDAR_DAYS_TO_SHOW = 20; // ИЗМЕНЕНО: Новая константа для управления диапазоном дат
    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    document.body.style.backgroundColor = tg.themeParams.bg_color || '#f0f3f8';

    // --- DOM ЭЛЕМЕНТЫ ---
    const elements = {
        loader: document.getElementById('loader-container'),
        headerTitle: document.getElementById('header-title'),
        backBtn: document.getElementById('back-btn'),
        screens: {
            location: document.getElementById('location-screen'),
            calendar: document.getElementById('calendar-screen'),
        },
        locationList: document.getElementById('location-list'),
        calendarWrapper: document.getElementById('calendar-wrapper'),
        modal: {
            overlay: document.getElementById('detail-modal'),
            dateHeader: document.getElementById('modal-date-header'),
            sessionsList: document.getElementById('modal-sessions-list'),
            closeBtn: document.getElementById('close-modal-btn'),
            notifyBtn: document.getElementById('add-notification-btn'),
        }
    };

    // --- УПРАВЛЕНИЕ СОСТОЯНИЕМ ---
    let state = {
        currentScreen: 'location',
        selectedLocationId: null,
        selectedLocationName: '',
        availableDates: new Set(),
        selectedDateForModal: null,
    };

    // --- ЛОГИКА API ---
    async function fetchAPI(path, options = {}) {
        const defaultHeaders = { 'Bypass-Tunnel-Reminder': 'true' };
        options.headers = { ...defaultHeaders, ...options.headers };

        try {
            const response = await fetch(API_BASE_URL + path, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Ошибка сети' }));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            console.error('Ошибка API:', error);
            tg.showAlert(`Ошибка при запросе к серверу: ${error.message}`);
            throw error;
        }
    }

    // --- ФУНКЦИИ ОТОБРАЖЕНИЯ ---
    function showScreen(screenName) {
        Object.values(elements.screens).forEach(s => s.classList.remove('active'));
        elements.screens[screenName].classList.add('active');
        state.currentScreen = screenName;
        updateHeader();
    }

    function showLoader() { elements.loader.classList.remove('hidden'); }
    function hideLoader() { elements.loader.classList.add('hidden'); }

    function updateHeader() {
        if (state.currentScreen === 'location') {
            elements.headerTitle.textContent = 'Локации';
            tg.BackButton.hide();
        } else if (state.currentScreen === 'calendar') {
            elements.headerTitle.textContent = state.selectedLocationName;
            tg.BackButton.show();
        }
    }

    async function init() {
        showLoader();
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
            showScreen('location');
        } catch (error) {
            // Ошибка уже показана в fetchAPI
        } finally {
            hideLoader();
        }
    }

    function renderLocations(locations) {
        elements.locationList.innerHTML = '';
        locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'location-card';
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => onLocationSelect(loc));
            elements.locationList.appendChild(card);
        });
    }

    async function onLocationSelect(location) {
        state.selectedLocationId = location.id;
        state.selectedLocationName = location.name;
        showLoader();
        showScreen('calendar');
        try {
            const data = await fetchAPI(`/api/calendar?location_id=${state.selectedLocationId}`);
            state.availableDates = new Set(data.available_dates);
            renderCalendars(); // ИЗМЕНЕНО: Вызываем новую функцию
        } catch (error) {
            showScreen('location');
        } finally {
            hideLoader();
        }
    }

    // ИЗМЕНЕНО: Полностью переписанная логика рендеринга календаря
    function renderCalendars() {
        elements.calendarWrapper.innerHTML = '';
        const today = new Date();
        const firstMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);

        // Определяем конечную дату для отображения
        const limitDate = new Date(today);
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);

        // Рендерим первый месяц
        elements.calendarWrapper.appendChild(createCalendarInstance(firstMonthDate));

        // Рендерим второй месяц, только если диапазон 20 дней заходит на него
        if (limitDate.getMonth() !== today.getMonth()) {
            const secondMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            elements.calendarWrapper.appendChild(createCalendarInstance(secondMonthDate));
        }
    }

    function createCalendarInstance(dateForMonth) {
        const instance = document.createElement('div');
        instance.className = 'calendar-instance';

        const header = document.createElement('div');
        header.className = 'calendar-header';
        header.innerHTML = `<h2>${dateForMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2>`;

        const weekdays = document.createElement('div');
        weekdays.className = 'weekdays-grid';
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
            weekdays.innerHTML += `<div>${day}</div>`;
        });

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        const year = dateForMonth.getFullYear();
        const month = dateForMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Нормализуем для точного сравнения

        const limitDate = new Date();
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);
        limitDate.setHours(0, 0, 0, 0);

        let firstDayOfWeek = new Date(year, month, 1).getDay();
        if (firstDayOfWeek === 0) firstDayOfWeek = 7; // Вс = 7, Пн = 1

        for (let i = 1; i < firstDayOfWeek; i++) {
            grid.innerHTML += `<div class="calendar-day is-placeholder"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            const currentDate = new Date(year, month, day);
            dayCell.className = 'calendar-day';

            // Проверяем, входит ли день в наш 20-дневный диапазон
            if (currentDate >= today && currentDate < limitDate) {
                dayCell.classList.add('is-future');
                const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                if (state.availableDates.has(fullDateStr)) {
                    dayCell.classList.add('has-sessions');
                    dayCell.addEventListener('click', () => onDateClick(fullDateStr));
                }
            }

            const span = document.createElement('span');
            span.textContent = day;
            dayCell.appendChild(span);

            if (currentDate.getTime() === today.getTime()) {
                dayCell.classList.add('is-today');
            }

            grid.appendChild(dayCell);
        }

        instance.append(header, weekdays, grid);
        return instance;
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        elements.modal.dateHeader.textContent = new Date(dateStr.replace(/-/g, '/')).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        elements.modal.sessionsList.innerHTML = '<div class="loader-container" style="height: 100px;"><div class="padel-loader" style="width: 25px; height: 25px; border-width: 3px;"></div></div>';
        elements.modal.overlay.classList.add('visible');

        try {
            const data = await fetchAPI(`/api/sessions?location_id=${state.selectedLocationId}&date=${dateStr}`);
            renderSessions(data.sessions);
        } catch (error) {
            elements.modal.sessionsList.innerHTML = `<div class="list-item"><div class="list-item-title">Ошибка загрузки</div></div>`;
        }
    }

    function renderSessions(sessions) {
        if (!sessions || sessions.length === 0) {
            elements.modal.sessionsList.innerHTML = `<div class="list-item"><div class="list-item-title">Свободных сеансов нет</div></div>`;
            return;
        }
        elements.modal.sessionsList.innerHTML = '';
        sessions.forEach(s => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${s.time}</div><div class="list-item-subtitle">${s.details}</div>`;
            elements.modal.sessionsList.appendChild(item);
        });
    }

    async function addNotification() {
        tg.showConfirm(`Добавить отслеживание на ${new Date(state.selectedDateForModal.replace(/-/g, '/')).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}?`, async (ok) => {
            if (ok) {
                try {
                    tg.MainButton.showProgress();
                    await fetchAPI('/api/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            initData: tg.initData,
                            location_id: state.selectedLocationId,
                            date: state.selectedDateForModal
                        })
                    });
                    tg.close();
                } catch(error) {
                    tg.showAlert(`Не удалось добавить уведомление: ${error.message}`);
                } finally {
                    tg.MainButton.hideProgress();
                }
            }
        });
    }

    // --- ОБРАБОТЧИКИ СОБЫТИЙ ---
    elements.backBtn.addEventListener('click', () => {
        if (state.currentScreen === 'calendar') {
            showScreen('location');
        }
    });
    tg.BackButton.onClick(() => elements.backBtn.click());

    elements.modal.closeBtn.addEventListener('click', () => elements.modal.overlay.classList.remove('visible'));
    elements.modal.overlay.addEventListener('click', (e) => {
        if (e.target === elements.modal.overlay) {
            elements.modal.overlay.classList.remove('visible');
        }
    });
    elements.modal.notifyBtn.addEventListener('click', addNotification);

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    init();
});
