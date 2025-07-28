// script.js
document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();

    // Экраны
    const locationScreen = document.getElementById('location-screen');
    const sessionsScreen = document.getElementById('sessions-screen');

    // Элементы UI
    const locationList = document.getElementById('location-list');
    const sessionsList = document.getElementById('sessions-list');
    const sessionsHeader = document.getElementById('sessions-header');
    const backToLocationsBtn = document.getElementById('back-to-locations');
    const currentDateEl = document.getElementById('current-date');
    const prevDayBtn = document.getElementById('prev-day');
    const nextDayBtn = document.getElementById('next-day');
    const addNotificationBtn = document.getElementById('add-notification-btn');

    let currentDate = new Date();
    let selectedLocation = null;

    // --- Функции навигации ---
    function showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    // --- Функции загрузки данных ---
    async function fetchLocations() {
        try {
            // В реальном приложении URL будет из конфига, например '/api/locations'
            const response = await fetch('/api/locations');
            const data = await response.json();
            renderLocations(data.locations);
        } catch (error) {
            console.error('Ошибка загрузки локаций:', error);
            locationList.innerHTML = '<div class="list-item">Не удалось загрузить локации</div>';
        }
    }

    async function fetchSessions() {
        if (!selectedLocation) return;
        const dateString = currentDate.toISOString().split('T')[0];
        sessionsList.innerHTML = '<div class="skeleton-item"></div><div class="skeleton-item"></div>';

        try {
            // Аналогично, URL будет '/api/sessions'
            const response = await fetch(`/api/sessions?location=${encodeURIComponent(selectedLocation)}&date=${dateString}`);
            const data = await response.json();
            renderSessions(data);
        } catch (error) {
            console.error('Ошибка загрузки сеансов:', error);
            sessionsList.innerHTML = '<div class="list-item">Не удалось загрузить сеансы</div>';
        }
    }

    // --- Функции отрисовки ---
    function renderLocations(locations) {
        locationList.innerHTML = '';
        locations.forEach(loc => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<span class="list-item-title">${loc.name}</span><span class="chevron">&gt;</span>`;
            item.addEventListener('click', () => {
                selectedLocation = loc.id;
                sessionsHeader.textContent = loc.name;
                updateCurrentDate();
                fetchSessions();
                showScreen(sessionsScreen);
            });
            locationList.appendChild(item);
        });
    }

    function renderSessions(data) {
        sessionsList.innerHTML = '';
        if (Object.keys(data).length === 0) {
            sessionsList.innerHTML = '<div class="list-item">На эту дату свободных сеансов нет</div>';
            return;
        }
        for (const time in data) {
            const courtData = data[time];
            let details = Object.entries(courtData).map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            sessionsList.appendChild(item);
        }
    }

    function updateCurrentDate() {
        currentDateEl.textContent = currentDate.toLocaleDateString('ru-RU', {
            weekday: 'short', day: 'numeric', month: 'long'
        });
    }

    // --- Обработчики событий ---
    backToLocationsBtn.addEventListener('click', () => {
        showScreen(locationScreen);
    });

    prevDayBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        updateCurrentDate();
        fetchSessions();
    });

    nextDayBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 1);
        updateCurrentDate();
        fetchSessions();
    });

    addNotificationBtn.addEventListener('click', () => {
        // Здесь мы можем показать пользователю модальное окно или
        // просто использовать MainButton для подтверждения
        tg.MainButton.setText(`Уведомить о сеансах`);
        tg.MainButton.show();
        tg.MainButton.onClick(async () => {
            const subscription = {
                location: selectedLocation,
                hour: -1, // -1 означает любое время
                court_types: ["Корт для 4-х", "Корт для 2-х"], // Для примера, можно дать выбор
                monitor_data: { type: "specific", value: currentDate.toISOString().split('T')[0] }
            };

            try {
                await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        initData: tg.initData,
                        subscription: subscription
                    })
                });
                tg.close(); // Закрываем Mini App после успешной подписки
            } catch (error) {
                console.error('Ошибка подписки:', error);
                tg.showAlert('Не удалось добавить уведомление.');
            }
        });
    });

    // Инициализация
    fetchLocations();
});
