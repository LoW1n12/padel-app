document.addEventListener('DOMContentLoaded', () => {
    // --- НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ ---
    const API_BASE_URL = "https://rotten-dancers-build.loca.lt"; // !!! ЗАМЕНИТЕ НА ВАШ АДРЕС ОТ LOCALTUNNEL !!!
    const CALENDAR_DAYS_TO_SHOW = 20;
    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    // --- DOM ЭЛЕМЕНТЫ ---
    const elements = {
        loader: document.getElementById('loader-container'),
        headerTitle: document.getElementById('header-title'),
        backBtn: document.getElementById('back-btn'),
        screens: { location: document.getElementById('location-screen'), calendar: document.getElementById('calendar-screen') },
        locationList: document.getElementById('location-list'),
        calendarWrapper: document.getElementById('calendar-wrapper'),
        modal: {
            overlay: document.getElementById('detail-modal'),
            dateHeader: document.getElementById('modal-date-header'),
            sessionsGrid: document.getElementById('sessions-grid'),
            closeBtn: document.getElementById('close-modal-btn'),
            notifyBtn: document.getElementById('add-notification-btn'),
            bookingBtn: document.getElementById('booking-link-btn'),
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

    function showScreen(screenName) {
        Object.values(elements.screens).forEach(s => s.classList.remove('active'));
        elements.screens[screenName].classList.add('active');
        state.currentScreen = screenName;
        updateHeader();
    }

    function showLoader() { elements.loader.classList.remove('hidden'); }
    function hideLoader() { elements.loader.classList.add('hidden'); }

    function updateHeader() {
        elements.headerTitle.textContent = state.currentScreen === 'location' ? 'Локации' : state.selectedLocationName;
        state.currentScreen === 'calendar' ? tg.BackButton.show() : tg.BackButton.hide();
    }

    async function init() {
        showLoader();
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
            showScreen('location');
        } catch (error) { /* Ошибка уже показана */ } finally {
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
            renderCalendars();
        } catch (error) { showScreen('location'); } finally {
            hideLoader();
        }
    }

    function renderCalendars() {
        elements.calendarWrapper.innerHTML = '';
        const today = new Date();
        const firstMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const limitDate = new Date(today);
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);
        elements.calendarWrapper.appendChild(createCalendarInstance(firstMonthDate));
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
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => { weekdays.innerHTML += `<div>${day}</div>`; });
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        const year = dateForMonth.getFullYear();
        const month = dateForMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const limitDate = new Date();
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);
        limitDate.setHours(0, 0, 0, 0);
        let firstDayOfWeek = new Date(year, month, 1).getDay();
        if (firstDayOfWeek === 0) firstDayOfWeek = 7;
        for (let i = 1; i < firstDayOfWeek; i++) { grid.innerHTML += `<div class="calendar-day is-placeholder"></div>`; }
        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            const currentDate = new Date(year, month, day);
            dayCell.className = 'calendar-day';
            const span = document.createElement('span');
            span.textContent = day;
            dayCell.appendChild(span);
            if (currentDate >= today && currentDate < limitDate) {
                dayCell.classList.add('is-future');
                const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                if (state.availableDates.has(fullDateStr)) { dayCell.classList.add('has-sessions'); }
                dayCell.addEventListener('click', () => onDateClick(fullDateStr));
            } else { dayCell.classList.add('is-past'); }
            if (currentDate.getTime() === today.getTime()) { dayCell.classList.add('is-today'); }
            grid.appendChild(dayCell);
        }
        instance.append(header, weekdays, grid);
        return instance;
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        elements.modal.dateHeader.textContent = new Date(dateStr.replace(/-/g, '/')).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        elements.modal.sessionsGrid.innerHTML = '<div class="loader-container" style="height: 100px;"><div class="padel-loader" style="width: 25px; height: 25px; border-width: 3px;"></div></div>';
        elements.modal.overlay.classList.add('visible');
        try {
            const data = await fetchAPI(`/api/sessions?location_id=${state.selectedLocationId}&date=${dateStr}`);
            renderSessions(data);
        } catch (error) {
            elements.modal.sessionsGrid.innerHTML = `<p class="no-sessions-message">Ошибка загрузки сеансов</p>`;
            elements.modal.bookingBtn.classList.add('hidden');
        }
    }

    function renderSessions(data) {
        const grid = elements.modal.sessionsGrid;
        grid.innerHTML = '';

        // ИЗМЕНЕНО: Добавляем/убираем класс для управления стилем
        if (data.sessions && data.sessions.length > 0) {
            grid.classList.remove('empty');
            data.sessions.forEach(s => {
                const item = document.createElement('div');
                item.className = 'session-slot';
                item.innerHTML = `<div class="session-slot-time">${s.time}</div><div class="session-slot-details">${s.details}</div>`;
                grid.appendChild(item);
            });
            if (data.booking_link) {
                elements.modal.bookingBtn.href = data.booking_link;
                elements.modal.bookingBtn.classList.remove('hidden');
            } else {
                elements.modal.bookingBtn.classList.add('hidden');
            }
        } else {
            grid.classList.add('empty');
            grid.innerHTML = `<p class="no-sessions-message">Свободных сеансов нет</p>`;
            elements.modal.bookingBtn.classList.add('hidden');
        }
    }

    async function addNotification() {
        tg.showConfirm(`Добавить отслеживание на ${new Date(state.selectedDateForModal.replace(/-/g, '/')).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}?`, async (ok) => {
            if (ok) {
                try {
                    tg.MainButton.showProgress();
                    await fetchAPI('/api/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ initData: tg.initData, location_id: state.selectedLocationId, date: state.selectedDateForModal })
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
    elements.backBtn.addEventListener('click', () => { if (state.currentScreen === 'calendar') { showScreen('location'); } });
    tg.BackButton.onClick(() => elements.backBtn.click());
    elements.modal.closeBtn.addEventListener('click', () => elements.modal.overlay.classList.remove('visible'));
    elements.modal.overlay.addEventListener('click', (e) => { if (e.target === elements.modal.overlay) { elements.modal.overlay.classList.remove('visible'); } });
    elements.modal.notifyBtn.addEventListener('click', addNotification);

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    init();
});
