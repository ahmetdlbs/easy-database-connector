import { query, execute, transaction, queryWithPagination } from './core/database';
export { redisService } from './services/redis.service';
export { mssql } from './types/database.types';

const example = async () => {
    setInterval(async () => {
        const data = await queryWithPagination({
            sql: "SELECT u.id, c.defaultProvide, CAST(DecryptByKey(u.firstName) AS nvarchar(MAX)) AS firstName, CAST(DecryptByKey(u.lastName) AS nvarchar(MAX)) AS lastName, CAST(DecryptByKey(u.email) AS nvarchar(MAX)) AS email, u.authority, u.language, u.addDate, u.password, u.companyId, u.isExtract, c.name AS companyName, c.type AS companyType, c.accessKey, ( SELECT moduleId FROM tourModule WHERE userId = u.id FOR JSON PATH ) AS tourModuleIds FROM users u LEFT JOIN company c ON c.id = u.companyId WHERE u.isDelete = 1",
            parameters: [],
            page: 0,
            pageSize: 15,
            encryption: {
                open: {
                    aes: true,
                    masterkey: true
                },
            },
        });
        console.log(data.detail.length)
    }, 1000);
}

example()