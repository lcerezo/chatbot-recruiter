FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY resume-context.json /usr/share/nginx/html/
COPY avatar.png /usr/share/nginx/html/
COPY system-prompt.txt /usr/share/nginx/html/
COPY guardrails.json /usr/share/nginx/html/

EXPOSE 8888
