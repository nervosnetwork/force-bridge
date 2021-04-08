#!/usr/bin/env bash

set -o errexit
set -o xtrace

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd .. && pwd )"
DB_NAME=forcebridge
DB_PATH=mysql://root:root@127.0.0.1:3306/${DB_NAME}
MYSQL_NAME=force_bridge_mysql

start_mysql() {
    docker run -e MYSQL_ROOT_PASSWORD=root -p 3306:3306 --name ${MYSQL_NAME} -d mysql:5.7
    docker exec ${MYSQL_NAME} bash -c "echo -e '[mysqld]\nskip-grant-tables' > /etc/mysql/conf.d/my.cnf"
    docker restart ${MYSQL_NAME}
    sleep 8

    docker exec ${MYSQL_NAME} mysql --user root --password=root -e "create database ${DB_NAME}; use ${DB_NAME}; show tables;"
    files=$(ls $SQL_PATH)
    for filename in $files
    do
      if [ "${filename##*.}" = "sql" ]; then
        docker cp $SQL_PATH$filename ${MYSQL_NAME}:/tmp/$filename
        docker exec ${MYSQL_NAME} mysql --user root --password=root -e "use ${DB_NAME};source /tmp/${filename};"
        sleep 1
      fi
    done
    docker exec ${MYSQL_NAME} mysql --user root --password=root -e "show databases;"
    echo "***** start mysql successfully *****"
}

start_mysql
