(function () {
  var menuButton = document.querySelector(".menu-toggle");
  var menu = document.querySelector(".main-nav");
  var year = document.getElementById("year");

  if (year) year.textContent = String(new Date().getFullYear());

  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      var open = menuButton.getAttribute("aria-expanded") !== "true";
      menuButton.setAttribute("aria-expanded", String(open));
      menu.classList.toggle("is-open", open);
    });
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menuButton.setAttribute("aria-expanded", "false");
        menu.classList.remove("is-open");
      });
    });
  }

  var heroVisual = document.querySelector(".hero-visual");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var heroImage = document.getElementById("hero-image");
  var heroCaption = document.getElementById("hero-caption");
  if (heroImage && !reduceMotion) {
    var heroSlides = [
      { src: "/assets/instagram-interior.jpg", alt: "Interior da Exclusive Solario com iluminação azul e violeta", caption: "AMBIENTE EXCLUSIVE" },
      { src: "/assets/instagram-entrada.jpg", alt: "Terminal de entrada autónoma com a marca Exclusive Solario", caption: "ENTRADA AUTÓNOMA" },
      { src: "/assets/instagram-produtos.jpg", alt: "Máquina de produtos no interior do solário", caption: "PRODUTOS NO ESPAÇO" },
      { src: "/assets/instagram-detalhes.jpg", alt: "Detalhes decorativos e produtos expostos na Exclusive Solario", caption: "DETALHES EXCLUSIVE" }
    ];
    var slideIndex = 0;
    window.setInterval(function () {
      slideIndex = (slideIndex + 1) % heroSlides.length;
      heroImage.classList.add("is-changing");
      window.setTimeout(function () {
        heroImage.src = heroSlides[slideIndex].src;
        heroImage.alt = heroSlides[slideIndex].alt;
        if (heroCaption) heroCaption.textContent = heroSlides[slideIndex].caption;
        window.requestAnimationFrame(function () { heroImage.classList.remove("is-changing"); });
      }, 750);
    }, 6500);
  }

  if (heroVisual && !reduceMotion) {
    heroVisual.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") return;
      var bounds = heroVisual.getBoundingClientRect();
      var horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
      var vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
      heroVisual.style.setProperty("--tilt-x", (horizontal * 7).toFixed(2) + "deg");
      heroVisual.style.setProperty("--tilt-y", (-vertical * 4).toFixed(2) + "deg");
    });
    heroVisual.addEventListener("pointerleave", function () {
      heroVisual.style.setProperty("--tilt-x", "0deg");
      heroVisual.style.setProperty("--tilt-y", "0deg");
    });
  }

  var contactForm = document.getElementById("contact-form");
  var contactFeedback = document.getElementById("contact-feedback");
  if (contactForm && contactFeedback) {
    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;
      var submitButton = contactForm.querySelector("button[type=submit]");
      var formData = new FormData(contactForm);
      var payload = {
        name: formData.get("name"),
        phone: formData.get("phone"),
        consent: formData.get("autorizacao_contacto") === "sim",
        website: formData.get("website")
      };
      if (submitButton) submitButton.disabled = true;
      contactFeedback.classList.remove("is-error");
      contactFeedback.textContent = "A enviar o teu pedido…";
      fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin"
      }).then(function (response) {
        if (!response.ok) {
          return response.json().then(function (result) {
            throw new Error(result.error || "O pedido não ficou registado.");
          });
        }
        contactForm.reset();
        contactFeedback.textContent = "Pedido recebido. A equipa Exclusive Solario entrará em contacto contigo.";
      }).catch(function () {
        contactFeedback.classList.add("is-error");
        contactFeedback.textContent = "Não foi possível enviar agora. Tenta novamente ou contacta-nos pelo Instagram.";
      }).finally(function () {
        if (submitButton) submitButton.disabled = false;
      });
    });
  }

  var reelDialog = document.getElementById("reel-dialog");
  var reelFrame = reelDialog && reelDialog.querySelector(".reel-frame");
  var reelClose = reelDialog && reelDialog.querySelector(".reel-close");
  var reelLink = reelDialog && reelDialog.querySelector(".reel-dialog-link");
  if (reelDialog && reelFrame) {
    document.querySelectorAll("[data-reel]").forEach(function (button) {
      button.addEventListener("click", function () {
        var reelId = button.getAttribute("data-reel");
        if (!reelId) return;
        var reelUrl = "https://www.instagram.com/reel/" + encodeURIComponent(reelId) + "/";
        reelFrame.src = reelUrl + "embed/";
        if (reelLink) reelLink.href = reelUrl;
        reelDialog.showModal();
      });
    });
    if (reelClose) reelClose.addEventListener("click", function () { reelDialog.close(); });
    reelDialog.addEventListener("click", function (event) {
      if (event.target === reelDialog) reelDialog.close();
    });
    reelDialog.addEventListener("close", function () { reelFrame.src = "about:blank"; });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
