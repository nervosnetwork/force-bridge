# FROM mysql:5.7

# RUN apt-get update && apt-get install -y npm && npm install -g ts-node

FROM node:14
RUN npm install -g ts-node

WORKDIR /usr/app
RUN mkdir /usr/app/workspace

COPY ./entrypoint.sh ./
RUN chmod 755 ./entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]