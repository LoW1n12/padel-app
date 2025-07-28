// webapp/script.js (финальная версия с обходом защиты localtunnel)

// Вставьте сюда свой URL, который выдал localtunnel
const API_BASE_URL = "https://brave-loops-clean.loca.lt";

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    // Экраны и модалка
    const locationScreen = document.getElementById('location-screen');
    const calendarScreen = document.getElementById('calendar-screen');
    const detailModal = document.getElementById('detail-modal');

    // Элементы UI
    const locationList = document.getElementById('location-list');
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYearHeader = document.getElementById('month-year-header');
    const calendarLocationHeader = document.getElementById('calendar-location-header');
    const backToLocationsBtn = document.getElementById('back-to-locations');
    const modalDateHeader = document.getElementById('modal-date-header');
    const modalSessionsList = document.getElementById('modal-sessions-list');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const addNotificationBtn = document.getElementById('add-notification-btn');

    // Состояние приложения
    let state = {
        selectedLocation: null,
        currentDate: new Date(),
        availableDates: new Set(),
        selectedDateForModal: null,
    };

    function showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    async function fetchAPI(path) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: { 'Bypass-Tunnel-Reminder': 'true' }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }

    async function fetchLocations() {
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
        } catch (error) {
            console.error('Ошибка загрузки локаций:', error);
            locationList.innerHTML = '<div class="list-item">Не удалось загрузить локации. Убедитесь, что бот и туннель запущены.</div>';
        }
    }

    async function fetchCalendarData() {
        if (!state.selectedLocation) return;
        calendarGrid.innerHTML = ''; // Очистка перед загрузкой
        try {
            const data = await fetchAPI(`/api/calendar?location=${encodeURIComponent(state.selectedLocation)}`);
            state.availableDates = new Set(data.available_dates);
            renderCalendar(state.currentDate.getFullYear(), state.currentDate.getMonth());
        } catch (error) {
            console.error('Ошибка загрузки данных для календаря:', error);
        }
    }

    function renderLocations(locations) {
        locationList.innerHTML = '';
        locations.forEach(loc => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<span class="list-item-title">${loc.name}</span><span class="chevron">&gt;</span>`;
            item.addEventListener('click', () => {
                state.selectedLocation = loc.id;
                calendarLocationHeader.textContent = loc.name;
                fetchCalendarData();
                showScreen(calendarScreen);
                tg.BackButton.show();
            });
            locationList.appendChild(item);
        });
    }

    function renderCalendar(year, month) {
        calendarGrid.innerHTML = '';
        monthYearHeader.textContent = new Date(year, month).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();

        let date = 1;
        for (let i = 0; i < 6 * 7; i++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';

            // day() в JS: 0-Вс, 1-Пн, ...
            // Нам нужно: 0-Пн, ..., 6-Вс
            const adjustedFirstDay = (firstDay === 0) ? 6 : firstDay - 1;

            if (i >= adjustedFirstDay && date <= daysInMonth) {
                const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

                dayCell.classList.add('is-in-month');
                const span = document.createElement('span');
                span.textContent = date;
                dayCell.appendChild(span);

                if (date === today.getDate() && year === today.getFullYear() && month === today.getMonth()) {
                    dayCell.classList.add('is-today');
                }

                if (state.availableDates.has(fullDateStr)) {
                    dayCell.classList.add('has-sessions');
                    dayCell.addEventListener('click', () => onDateClick(fullDateStr));
                }

                date++;
            } else {
                dayCell.classList.add('is-disabled');
            }
            calendarGrid.appendChild(dayCell);
        }
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        modalDateHeader.textContent = new Date(dateStr).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        modalSessionsList.innerHTML = '<div class="skeleton-item" style="height: 30px; margin: 8px 0;"></div>';
        detailModal.classList.add('visible');

        try {
            const data = await fetchAPI(`/api/sessions?location=${encodeURIComponent(state.selectedLocation)}&date=${dateStr}`);
            renderModalSessions(data);
        } catch (error) {
            modalSessionsList.innerHTML = '<div class="list-item">Ошибка загрузки</div>';
        }
    }

    function renderModalSessions(data) {
        modalSessionsList.innerHTML = '';
        if (Object.keys(data).length === 0) {
            modalSessionsList.innerHTML = '<div class="list-item">Сеансов нет</div>';
            return;
        }
        for (const time in data) {
            const courtData = data[time];
            let details = Object.entries(courtData).map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            modalSessionsList.appendChild(item);
        }
    }

    // --- Обработчики событий ---
    tg.onEvent('backButtonClicked', () => {
        showScreen(locationScreen);
        tg.BackButton.hide();
    });

    backToLocationsBtn.addEventListener('click', () => tg.BackButton.onClick());

    closeModalBtn.addEventListener('click', () => detailModal.classList.remove('visible'));
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) {
            detailModal.classList.remove('visible');
        }
    });

    addNotificationBtn.addEventListener('click', () => {
        tg.MainButton.setText(`Уведомить о сеансах на ${new Date(state.selectedDateForModal).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})}`);
        tg.MainButton.show();
        tg.MainButton.onClick(onConfirmNotification);
    });

    async function onConfirmNotification() {
        const subscription = {
            location: state.selectedLocation,
            hour: -1,
            court_types: ["Корт для 4-х", "Корт для 2-х", "Открытый корт", "Закрытый корт", "Корт (тип 1)", "Корт (тип 2)", "Ultra корт", "Корт"],
            monitor_data: { type: "specific", value: state.selectedDateForModal }
        };

        try {
            await fetch(`${API_BASE_URL}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
                body: JSON.stringify({ initData: tg.initData, subscription: subscription })
            });
            tg.showAlert('Уведомление успешно добавлено!');
        } catch (error) {
            tg.showAlert('Не удалось добавить уведомление.');
        } finally {
            tg.MainButton.hide();
            tg.MainButton.offClick(onConfirmNotification);
            detailModal.classList.remove('visible');
        }
    }

    // --- Инициализация ---
    fetchLocations();
});
