document.addEventListener('DOMContentLoaded', () => {
    // --- НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ ---
    const API_BASE_URL = "https://eighty-radios-punch.loca.lt"; // !!! ЗАМЕНИТЕ НА ВАШ АДРЕС ОТ LOCALTUNNEL !!!
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
        viewSwitcher: document.getElementById('view-switcher'),
        showListBtn: document.getElementById('show-list-btn'),
        showMapBtn: document.getElementById('show-map-btn'),
        listView: document.getElementById('list-view'),
        mapView: document.getElementById('map-view'),
        calendarView: document.getElementById('calendar-view'),
        locationList: document.getElementById('location-list'),
        mapContainer: document.getElementById('map'),
        calendarWrapper: document.getElementById('calendar-wrapper'),
        mapPanel: {
            overlay: document.getElementById('map-panel-overlay'),
            content: document.getElementById('map-location-panel'),
            name: document.getElementById('panel-location-name'),
            description: document.getElementById('panel-location-description'),
            selectBtn: document.getElementById('panel-select-btn'),
            routeBtn: document.getElementById('panel-route-btn'),
            taxiBtn: document.getElementById('panel-taxi-btn'),
        },
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
        currentView: 'list',
        locations: [],
        map: null,
        selectedLocationId: null,
        selectedLocationName: '',
        availableDates: new Set(),
        selectedDateForModal: null,
    };

    // --- УПРАВЛЕНИЕ ВИДАМИ (ЭКРАНАМИ) ---
    function showView(viewName) {
        state.currentView = viewName;
        ['list', 'map', 'calendar'].forEach(v => {
            elements[`${v}View`].classList.toggle('active', v === viewName);
        });
        elements.showListBtn.classList.toggle('active', viewName === 'list');
        elements.showMapBtn.classList.toggle('active', viewName === 'map');
        if (viewName === 'calendar') {
            elements.viewSwitcher.classList.add('hidden');
            tg.BackButton.show();
        } else {
            elements.viewSwitcher.classList.remove('hidden');
            tg.BackButton.hide();
        }
    }

    // --- ЛОГИКА API ---
    async function fetchAPI(path, options = {}) {
        options.headers = { 'Bypass-Tunnel-Reminder': 'true', ...options.headers };
        try {
            const response = await fetch(API_BASE_URL + path, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Ошибка сети' }));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            console.error('Ошибка API:', error);
            tg.showAlert(`Ошибка: ${error.message}`);
            throw error;
        }
    }

    function showLoader() { document.getElementById('loader-container').classList.remove('hidden'); }
    function hideLoader() { document.getElementById('loader-container').classList.add('hidden'); }

    function updateHeader() {
        elements.headerTitle.textContent = state.currentView === 'calendar' ? state.selectedLocationName : 'Локации';
    }

    // --- ОСНОВНЫЕ ФУНКЦИИ ---
    async function init() {
        showLoader();
        try {
            const data = await fetchAPI('/api/locations');
            state.locations = data.locations;
            renderLocations(state.locations);
            showView('list');
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

    function initMap() {
        if (state.map) return;
        ymaps.ready(() => {
            state.map = new ymaps.Map(elements.mapContainer, {
                center: [55.751244, 37.618423], zoom: 10, controls: ['zoomControl']
            });
            if (tg.colorScheme === 'dark') {
                elements.mapContainer.classList.add('dark-theme');
            }
            const customMarkerLayout = ymaps.templateLayoutFactory.createClass('<div class="custom-marker">🎾</div>');
            state.locations.forEach(loc => {
                if (loc.coords && loc.coords[0] !== 0) {
                    const placemark = new ymaps.Placemark(loc.coords, {
                        locationData: loc
                    }, {
                        iconLayout: customMarkerLayout,
                        iconShape: { type: 'Rectangle', coordinates: [[-16, -16], [16, 16]] }
                    });
                    placemark.events.add('click', (e) => {
                        const marker = e.get('target');
                        const data = marker.properties.get('locationData');
                        showMapLocationPanel(data);
                    });
                    state.map.geoObjects.add(placemark);
                }
            });
        });
    }

    function showMapLocationPanel(locData) {
        elements.mapPanel.name.textContent = locData.name;
        elements.mapPanel.description.textContent = locData.description;

        const newSelectBtn = elements.mapPanel.selectBtn.cloneNode(true);
        elements.mapPanel.selectBtn.parentNode.replaceChild(newSelectBtn, elements.mapPanel.selectBtn);
        elements.mapPanel.selectBtn = newSelectBtn;

        const newRouteBtn = elements.mapPanel.routeBtn.cloneNode(true);
        elements.mapPanel.routeBtn.parentNode.replaceChild(newRouteBtn, elements.mapPanel.routeBtn);
        elements.mapPanel.routeBtn = newRouteBtn;

        const newTaxiBtn = elements.mapPanel.taxiBtn.cloneNode(true);
        elements.mapPanel.taxiBtn.parentNode.replaceChild(newTaxiBtn, elements.mapPanel.taxiBtn);
        elements.mapPanel.taxiBtn = newTaxiBtn;

        elements.mapPanel.selectBtn.addEventListener('click', () => {
            hideMapLocationPanel();
            onLocationSelect(locData);
        });
        elements.mapPanel.routeBtn.addEventListener('click', () => {
            tg.openLink(`https://yandex.ru/maps/?rtext=~${locData.coords[0]},${locData.coords[1]}`);
        });
        elements.mapPanel.taxiBtn.addEventListener('click', () => {
            tg.openLink(`https://go.yandex/route?end-lat=${locData.coords[0]}&end-lon=${locData.coords[1]}`);
        });
        elements.mapPanel.overlay.classList.add('visible');
    }

    function hideMapLocationPanel() {
        elements.mapPanel.overlay.classList.remove('visible');
    }

    async function onLocationSelect(location) {
        state.selectedLocationId = location.id;
        state.selectedLocationName = location.name;
        showView('calendar');
        updateHeader();
        elements.calendarWrapper.innerHTML = '<div class="loader-container" style="height: 200px;"><div class="padel-loader"></div></div>';
        try {
            const data = await fetchAPI(`/api/calendar?location_id=${state.selectedLocationId}`);
            state.availableDates = new Set(data.available_dates);
            renderCalendars();
        } catch (error) {
            elements.calendarWrapper.innerHTML = '<p style="text-align: center; color: var(--tg-theme-hint-color);">Не удалось загрузить календарь</p>';
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
    elements.showListBtn.addEventListener('click', () => showView('list'));
    elements.showMapBtn.addEventListener('click', () => {
        showView('map');
        initMap();
    });
    tg.BackButton.onClick(() => {
        showView('list');
        updateHeader();
    });
    elements.backBtn.addEventListener('click', () => tg.BackButton.onClick());
    elements.modal.closeBtn.addEventListener('click', () => elements.modal.overlay.classList.remove('visible'));
    elements.modal.overlay.addEventListener('click', (e) => { if (e.target === elements.modal.overlay) { elements.modal.overlay.classList.remove('visible'); } });
    elements.mapPanel.overlay.addEventListener('click', (e) => {
        if (e.target === elements.mapPanel.overlay) { hideMapLocationPanel(); }
    });
    elements.modal.notifyBtn.addEventListener('click', addNotification);

    // --- ЗАПУСК ПРИЛОЖЕНИЯ ---
    init();
});
