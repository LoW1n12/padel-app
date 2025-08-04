document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = "https://tricky-books-run.loca.lt";
    const CALENDAR_DAYS_TO_SHOW = 20;
    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();

    const elements = {
        loader: document.getElementById('loader-container'),
        headerTitle: document.getElementById('header-title'),
        viewSwitcher: document.getElementById('view-switcher'),
        showListBtn: document.getElementById('show-list-btn'),
        showMapBtn: document.getElementById('show-map-btn'),
        listView: document.getElementById('list-view'),
        mapView: document.getElementById('map-view'),
        locationList: document.getElementById('location-list'),
        mapContainer: document.getElementById('map'),
        calendarInPanel: document.getElementById('calendar-wrapper'),
        mapPanel: {
            overlay: document.getElementById('map-panel-overlay'),
            content: document.getElementById('map-location-panel'),
            dragHandle: document.getElementById('panel-drag-handle'),
            closeBtn: document.getElementById('panel-close-btn'),
            name: document.getElementById('panel-location-name'),
            description: document.getElementById('panel-location-description'),
            selectBtn: document.getElementById('panel-select-btn'),
            routeBtn: document.getElementById('panel-route-btn'),
            taxiBtn: document.getElementById('panel-taxi-btn'),
        },
        modal: {
            overlay: document.getElementById('detail-modal'),
            closeBtn: document.getElementById('close-modal-btn'),
            dateHeader: document.getElementById('modal-date-header'),
            sessionsGrid: document.getElementById('sessions-grid'),
            notifyBtn: document.getElementById('add-notification-btn'),
            bookingBtn: document.getElementById('booking-link-btn'),
        }
    };

    let state = {
        locations: [], map: null, selectedLocationId: null, selectedLocationName: '',
        availableDates: new Set(), selectedDateForModal: null,
    };

    function showView(viewName) {
        elements.listView.classList.toggle('active', viewName === 'list');
        elements.mapView.classList.toggle('active', viewName === 'map');
        elements.showListBtn.classList.toggle('active', viewName === 'list');
        elements.showMapBtn.classList.toggle('active', viewName === 'map');
    }

    async function fetchAPI(path, options = {}) {
        options.headers = { 'Bypass-Tunnel-Reminder': 'true', ...options.headers };
        try {
            const response = await fetch(API_BASE_URL + path, options);
            if (!response.ok) throw new Error((await response.json()).error || 'Ошибка сети');
            return response.json();
        } catch (error) {
            tg.showAlert(`Ошибка: ${error.message}`);
            throw error;
        }
    }

    function showLoader(show) { elements.loader.classList.toggle('hidden', !show); }

    async function init() {
        showLoader(true);
        try {
            const data = await fetchAPI('/api/locations');
            state.locations = data.locations;
            renderLocations(state.locations);
            showView('list');
        } finally {
            showLoader(false);
        }
    }

    function renderLocations(locations) {
        elements.locationList.innerHTML = '';
        locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'location-card';
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => showMapLocationPanel(loc, true));
            elements.locationList.appendChild(card);
        });
    }

    function initMap() {
        if (state.map) return;
        ymaps.ready(() => {
            state.map = new ymaps.Map(elements.mapContainer, {
                center: [55.751244, 37.618423], zoom: 10, controls: ['zoomControl']
            });
            if (tg.colorScheme === 'dark') elements.mapContainer.classList.add('dark-theme');
            const customMarkerLayout = ymaps.templateLayoutFactory.createClass('<div class="custom-marker">🎾</div>');
            state.locations.forEach(loc => {
                if (loc.coords && loc.coords[0] !== 0) {
                    const placemark = new ymaps.Placemark(loc.coords, {}, {
                        iconLayout: customMarkerLayout,
                        interactivityModel: 'default#transparent',
                        iconShape: { type: 'Rectangle', coordinates: [[-20, -20], [20, 20]] }
                    });
                    placemark.events.add('click', () => showMapLocationPanel(loc));
                    state.map.geoObjects.add(placemark);
                }
            });
        });
    }

    function setupButton(buttonElement, listener) {
        const newBtn = buttonElement.cloneNode(true);
        buttonElement.parentNode.replaceChild(newBtn, buttonElement);
        newBtn.addEventListener('click', listener);
        return newBtn;
    }

    function showMapLocationPanel(locData, expand = false) {
        state.selectedLocationId = locData.id;
        state.selectedLocationName = locData.name;
        elements.mapPanel.name.textContent = locData.name;
        elements.mapPanel.description.textContent = locData.description;

        elements.mapPanel.content.classList.remove('expanded');

        elements.mapPanel.selectBtn = setupButton(elements.mapPanel.selectBtn, () => {
            elements.mapPanel.content.classList.add('expanded');
            loadAndRenderCalendarInPanel();
        });
        elements.mapPanel.routeBtn = setupButton(elements.mapPanel.routeBtn, () => tg.openLink(`https://yandex.ru/maps/?rtext=~${locData.coords[0]},${locData.coords[1]}`));
        elements.mapPanel.taxiBtn = setupButton(elements.mapPanel.taxiBtn, () => tg.openLink(`https://go.yandex/route?end-lat=${locData.coords[0]}&end-lon=${locData.coords[1]}`));
        elements.mapPanel.closeBtn = setupButton(elements.mapPanel.closeBtn, hideMapLocationPanel);

        if(expand) {
             elements.mapPanel.content.classList.add('expanded');
             loadAndRenderCalendarInPanel();
        }

        elements.mapPanel.overlay.classList.add('visible');
    }

    function hideMapLocationPanel() {
        elements.mapPanel.content.classList.remove('expanded');
        elements.mapPanel.overlay.classList.remove('visible');
    }

    async function loadAndRenderCalendarInPanel() {
        elements.calendarInPanel.innerHTML = '<div class="loader-container" style="height:200px;"><div class="padel-loader"></div></div>';
        try {
            const data = await fetchAPI(`/api/calendar?location_id=${state.selectedLocationId}`);
            state.availableDates = new Set(data.available_dates);
            renderCalendarsInPanel();
        } catch (error) {
            elements.calendarInPanel.innerHTML = '<p style="text-align:center;color:var(--tg-theme-hint-color);">Не удалось загрузить календарь</p>';
        }
    }

    function renderCalendarsInPanel() {
        elements.calendarInPanel.innerHTML = '';
        const today = new Date();
        const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        elements.calendarInPanel.appendChild(createCalendarInstance(firstMonth));

        const limitDate = new Date();
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);

        if (limitDate.getMonth() !== today.getMonth()) {
            const secondMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            elements.calendarInPanel.appendChild(createCalendarInstance(secondMonth));
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
        weekdays.innerHTML = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div>${d}</div>`).join('');
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        const year = dateForMonth.getFullYear();
        const month = dateForMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const limitDate = new Date(today);
        limitDate.setDate(today.getDate() + CALENDAR_DAYS_TO_SHOW);

        let firstDayOfWeek = new Date(year, month, 1).getDay();
        if (firstDayOfWeek === 0) firstDayOfWeek = 7;

        for (let i = 1; i < firstDayOfWeek; i++) { grid.innerHTML += `<div class="calendar-day is-placeholder"></div>`; }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            const currentDate = new Date(year, month, day);
            dayCell.className = 'calendar-day';
            dayCell.innerHTML = `<span>${day}</span>`;

            if (currentDate >= today && currentDate < limitDate) {
                const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                if (state.availableDates.has(fullDateStr)) dayCell.classList.add('has-sessions');
                dayCell.addEventListener('click', () => onDateClick(fullDateStr));
            } else {
                dayCell.classList.add('is-disabled');
            }
            if (currentDate.getTime() === today.getTime()) dayCell.classList.add('is-today');

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
            elements.modal.sessionsGrid.innerHTML = `<p class="no-sessions-message">Ошибка загрузки</p>`;
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
            elements.modal.bookingBtn.classList.toggle('hidden', !data.booking_link);
            if(data.booking_link) elements.modal.bookingBtn.href = data.booking_link;
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
                    tg.showAlert(`Не удалось добавить уведомление`);
                } finally {
                    tg.MainButton.hideProgress();
                }
            }
        });
    }

    elements.showListBtn.addEventListener('click', () => showView('list'));
    elements.showMapBtn.addEventListener('click', () => { showView('map'); initMap(); });
    elements.modal.closeBtn.addEventListener('click', () => elements.modal.overlay.classList.remove('visible'));
    elements.modal.overlay.addEventListener('click', (e) => { if (e.target === elements.modal.overlay) elements.modal.overlay.classList.remove('visible'); });
    elements.mapPanel.overlay.addEventListener('click', (e) => { if (e.target === elements.mapPanel.overlay) hideMapLocationPanel(); });
    elements.modal.notifyBtn.addEventListener('click', addNotification);

    let startY;
    elements.mapPanel.dragHandle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        elements.mapPanel.content.style.transition = 'none';
    }, { passive: true });
    elements.mapPanel.dragHandle.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 0) {
            elements.mapPanel.content.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: true });
    elements.mapPanel.dragHandle.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        elements.mapPanel.content.style.transition = 'all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
        if (endY - startY > 100) {
            hideMapLocationPanel();
        }
        setTimeout(() => {
            elements.mapPanel.content.style.transform = '';
        }, 0);
    });

    init();
});
