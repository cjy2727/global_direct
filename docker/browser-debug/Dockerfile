FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    HOME=/home/pwuser \
    TZ=Asia/Seoul \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/browser-debug-dbus \
    GTK_IM_MODULE=fcitx \
    QT_IM_MODULE=fcitx \
    XMODIFIERS=@im=fcitx

# Use official Ubuntu HTTPS repositories for the diagnostic desktop only.
RUN sed -i \
      -e 's|http://azure.archive.ubuntu.com/ubuntu/|https://archive.ubuntu.com/ubuntu/|g' \
      -e 's|http://security.ubuntu.com/ubuntu/|https://security.ubuntu.com/ubuntu/|g' \
      /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      supervisor xvfb x11vnc novnc websockify openbox fonts-noto-cjk \
      dbus-x11 fcitx5 fcitx5-hangul fcitx5-frontend-gtk3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/pwuser/browser-profile /home/pwuser/.cache \
    && chown -R pwuser:pwuser /home/pwuser/browser-profile /home/pwuser/.cache

COPY start.sh /opt/browser-debug/start.sh
COPY supervisord.conf /opt/browser-debug/supervisord.conf
COPY clipboard.js /usr/share/novnc/clipboard.js
COPY --chown=pwuser:pwuser fcitx5/ /home/pwuser/.config/fcitx5/
RUN sed -i 's/\r$//' /opt/browser-debug/start.sh \
    && chmod 755 /opt/browser-debug/start.sh \
    && sed -i '/<\/body>/i\    <script type="module" src="clipboard.js"></script>' /usr/share/novnc/vnc.html

USER pwuser
WORKDIR /home/pwuser
EXPOSE 6080
CMD ["/usr/bin/supervisord", "-c", "/opt/browser-debug/supervisord.conf"]
