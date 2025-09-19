document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = "https://clever-zebras-retire.loca.lt";
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    let state = {
        staticLocations: [],
        availability: new Map(),
        selectedDate: null,
        selectedTime: null,
        map: null,
        placemarks: new Map(),
    };

    const elements = {
        dateTimeView: document.getElementById('date-time-view'),
        dateSelector: document.getElementById('date-selector'),
        timeSelector: document.getElementById('time-selector'),
        anyTimeCheckbox: document.getElementById('any-time-checkbox'),
        findCourtsBtn: document.getElementById('find-courts-btn'),
        locationsView: document.getElementById('locations-view'),
        backToPickerBtn: document.getElementById('back-to-picker-btn'),
        selectedFilterDisplay: document.getElementById('selected-filter-display'),
        loader: document.getElementById('loader-container'),
        showListBtn: document.getElementById('show-list-btn'),
        showMapBtn: document.getElementById('show-map-btn'),
        listView: document.getElementById('list-view'),
        mapView: document.getElementById('map-view'),
        locationList: document.getElementById('location-list'),
        mapContainer: document.getElementById('map'),
        panel: {
            overlay: document.getElementById('location-panel-overlay'),
            content: document.getElementById('location-panel-content'),
            closeBtn: document.getElementById('panel-close-btn'),
            name: document.getElementById('panel-location-name'),
            description: document.getElementById('panel-location-description'),
            statusMsg: document.getElementById('panel-status-message'),
            actionBtn: document.getElementById('panel-action-btn'),
            routeBtn: document.getElementById('panel-route-btn'),
            infoBtn: document.getElementById('panel-info-btn'),
        },
    };

    async function fetchAPI(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: { 'Bypass-Tunnel-Reminder': 'true', ...options.headers },
            ...options
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Network error' }));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    function showView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewName).classList.add('active');
    }

    function formatShortDate(date) {
        return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' });
    }

    function init() {
        setupDateTimePickers();
        loadStaticLocations();
        addEventListeners();
        showView('date-time-view');
    }

    async function loadStaticLocations() {
        try {
            const data = await fetchAPI('/api/locations');
            state.staticLocations = data.locations;
        } catch (e) {
            tg.showAlert(`Failed to load location base information: ${e.message}`);
        }
    }

    function setupDateTimePickers() {
        const today = new Date();
        for (let i = 0; i < 30; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const item = document.createElement('div');
            item.className = 'selector-item date-item';
            item.dataset.date = date.toISOString().split('T')[0];
            item.innerHTML = `<span class="day-name">${formatShortDate(date)}</span><span class="day-num">${date.getDate()}</span>`;
            elements.dateSelector.appendChild(item);
        }

        for (let hour = 7; hour <= 22; hour++) {
            const time = `${String(hour).padStart(2, '0')}:00`;
            const item = document.createElement('div');
            item.className = 'selector-item time-item';
            item.dataset.time = time;
            item.textContent = time;
            elements.timeSelector.appendChild(item);
        }

        elements.dateSelector.firstElementChild.classList.add('selected');
        elements.timeSelector.children[5].classList.add('selected'); // Default to ~12:00
        state.selectedDate = elements.dateSelector.firstElementChild.dataset.date;
        state.selectedTime = elements.timeSelector.children[5].dataset.time;
    }

    function handleDateTimeSelection(event) {
        const target = event.target.closest('.selector-item');
        if (!target) return;

        const parent = target.parentElement;
        parent.querySelector('.selected')?.classList.remove('selected');
        target.classList.add('selected');
        
        if (parent.id === 'date-selector') {
            state.selectedDate = target.dataset.date;
        } else if (parent.id === 'time-selector') {
            state.selectedTime = target.dataset.time;
            elements.anyTimeCheckbox.checked = false;
        }
    }

    async function findAndShowCourts() {
        showView('locations-view');
        elements.loader.classList.remove('hidden');
        elements.listView.classList.remove('active');
        elements.mapView.classList.remove('active');
        elements.locationList.innerHTML = '';

        const time = elements.anyTimeCheckbox.checked ? 'any' : state.selectedTime;
        state.selectedTime = time;
        
        const dateObj = new Date(state.selectedDate);
        dateObj.setMinutes(dateObj.getMinutes() + dateObj.getTimezoneOffset());
        const timeText = time === 'any' ? 'Любое время' : time;
        elements.selectedFilterDisplay.textContent = `${formatShortDate(dateObj)}, ${timeText}`;

        try {
            const data = await fetchAPI(`/api/availability?date=${state.selectedDate}&time=${time}`);
            state.availability = new Map(data.availability.map(item => [item.id, { is_available: item.is_available }]));
            
            renderLocations();
            showSubView('list');
            initMap();
            updateMapMarkers();

        } catch (e) {
            tg.showAlert(`Search error: ${e.message}`);
            elements.loader.classList.add('hidden');
            elements.loader.innerHTML = '<p>Search failed.</p>';
        } finally {
            elements.loader.classList.add('hidden');
        }
    }

    function renderLocations() {
        elements.locationList.innerHTML = '';
        state.staticLocations.forEach(loc => {
            const isAvailable = state.availability.get(loc.id)?.is_available || false;
            const card = document.createElement('div');
            card.className = `location-card ${isAvailable ? '' : 'unavailable'}`;
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => showLocationPanel(loc.id));
            elements.locationList.appendChild(card);
        });
    }

    function initMap() {
        if (state.map) return;
        ymaps.ready(() => {
            state.map = new ymaps.Map(elements.mapContainer, { center: [55.75, 37.62], zoom: 10, controls: [] });
            state.staticLocations.forEach(loc => {
                if (loc.coords) {
                    const placemark = new ymaps.Placemark(loc.coords, {}, {
                        iconLayout: ymaps.templateLayoutFactory.createClass('<div class="custom-marker">🎾</div>')
                    });
                    placemark.events.add('click', () => showLocationPanel(loc.id));
                    state.map.geoObjects.add(placemark);
                    state.placemarks.set(loc.id, placemark);
                }
            });
        });
    }
    
    function updateMapMarkers() {
        if (!state.map) return;
        state.placemarks.forEach((placemark, locId) => {
            const isAvailable = state.availability.get(locId)?.is_available || false;
            const iconElement = placemark.getIconContent();
            if (iconElement && iconElement.parentElement) {
                iconElement.parentElement.classList.toggle('unavailable', !isAvailable);
            }
        });
    }
    
    function showSubView(viewName) {
        elements.listView.classList.toggle('active', viewName === 'list');
        elements.mapView.classList.toggle('active', viewName === 'map');
        elements.showListBtn.classList.toggle('active', viewName === 'list');
        elements.showMapBtn.classList.toggle('active', viewName === 'map');
    }

    function showLocationPanel(locationId) {
        const locData = state.staticLocations.find(l => l.id === locationId);
        if (!locData) return;

        const isAvailable = state.availability.get(locationId)?.is_available || false;

        elements.panel.name.textContent = locData.name;
        elements.panel.description.textContent = locData.description;
        
        const statusMsg = elements.panel.statusMsg;
        statusMsg.style.display = 'block';
        statusMsg.className = `panel-status-message ${isAvailable ? 'available' : 'unavailable'}`;
        statusMsg.textContent = isAvailable ? 'Slots available for the selected time' : 'All slots are taken for the selected time';

        const actionBtn = elements.panel.actionBtn;
        if (isAvailable) {
            actionBtn.textContent = '🎾 Book';
            actionBtn.className = 'panel-button book';
            actionBtn.onclick = () => {
                if(locData.booking_link) tg.openLink(locData.booking_link);
                else tg.showAlert('Booking link not found.');
            };
        } else {
            actionBtn.textContent = '🔔 Notify me';
            actionBtn.className = 'panel-button notify';
            actionBtn.onclick = () => addNotification(locationId);
        }

        elements.panel.routeBtn.onclick = () => tg.openLink(`https://yandex.ru/maps/?rtext=~${locData.coords.join(',')}`);
        elements.panel.infoBtn.onclick = () => tg.showAlert("Info panel is under construction."); // Placeholder

        elements.panel.overlay.classList.add('visible');
    }
    
    async function addNotification(locationId) {
        const timeText = state.selectedTime === 'any' ? 'any time' : state.selectedTime;
        const dateText = new Date(state.selectedDate).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
        
        tg.showConfirm(`Create a notification for "${locationId}" on ${dateText}, ${timeText}?`, async (ok) => {
            if (ok) {
                tg.MainButton.showProgress();
                try {
                    await fetchAPI('/api/notify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            initData: tg.initData,
                            location_id: locationId,
                            date: state.selectedDate,
                            time: state.selectedTime
                        })
                    });
                    tg.close();
                } catch (e) {
                    tg.showAlert(`Failed to add notification: ${e.message}`);
                } finally {
                    tg.MainButton.hideProgress();
                }
            }
        });
    }

    function addEventListeners() {
        elements.dateSelector.addEventListener('click', handleDateTimeSelection);
        elements.timeSelector.addEventListener('click', handleDateTimeSelection);
        elements.anyTimeCheckbox.addEventListener('change', (e) => {
            elements.timeSelector.style.opacity = e.target.checked ? 0.4 : 1;
            elements.timeSelector.style.pointerEvents = e.target.checked ? 'none' : 'auto';
        });

        elements.findCourtsBtn.addEventListener('click', findAndShowCourts);
        elements.backToPickerBtn.addEventListener('click', () => showView('date-time-view'));
        
        elements.showListBtn.addEventListener('click', () => showSubView('list'));
        elements.showMapBtn.addEventListener('click', () => showSubView('map'));

        elements.panel.overlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.currentTarget.classList.remove('visible');
        });
        elements.panel.closeBtn.addEventListener('click', () => elements.panel.overlay.classList.remove('visible'));
    }

    init();
});
