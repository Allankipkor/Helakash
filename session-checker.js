// ==========================================================================
// HELAKASH SESSION CHECKER
// Automatically logs out a user if their account no longer exists.
// ==========================================================================

(function () {
    const CHECK_INTERVAL = 15000; // Check every 15 seconds

    async function checkUserSession() {

        const phone = localStorage.getItem("helakash_user");

        // Nobody logged in
        if (!phone) return;

        try {

            const response = await fetch(
                `/api/user-details?phone=${encodeURIComponent(phone)}`,
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store"
                }
            );

            // User deleted
            if (response.status === 401 || response.status === 404) {
                forceLogout();
                return;
            }

            // Ignore temporary server errors
            if (!response.ok) {
                return;
            }

            const data = await response.json();

            if (!data.success || data.deleted === true) {
                forceLogout();
            }

        } catch (err) {
            console.error("Session check failed:", err);
        }

    }

    function forceLogout() {

        localStorage.removeItem("helakash_user");
        localStorage.removeItem("helakash_balance");
        localStorage.removeItem("helakash_txs");
        localStorage.removeItem("helakash_guest_id");

        sessionStorage.clear();

        alert("Your account no longer exists. Please sign in again.");

        window.location.href = "/";

    }

    // First check after page loads
    window.addEventListener("load", function () {

        checkUserSession();

        setInterval(checkUserSession, CHECK_INTERVAL);

    });

})();