var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var nodemailer = require('nodemailer');

var salt = 'MOLiXMysC';

var smtpConfig = {
    host: 'smtp.ncnu.edu.tw',
    port: 25,
};

// 報名資料驗證
function _verifyTeamObject(teamObject) {
    // 資料驗證模組
    const verifyModule = {
        // Regex 檢查
        password: (pwdStr) => {
            // 密碼最少四個字且要有一碼為英文
            return /^(?=.*[a-zA-Z])[0-9a-zA-Z]{4,}$/.test(pwdStr);
        },
        id: (idStr) => {
            // Ex: 10(4213083) 必須為 10 開頭且有後七碼數字
            return /^10\d{7}$/.test(idStr);
        },
        name: (nameStr) => {
            // 中英文可含空白、-, 並且至少要2位元
            return /^[-a-zA-Z_\s\u4e00-\u9fa5]{2,}$/.test(nameStr);
        },
        email: (emailStr) => {
            return /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(emailStr);
        },

    };
    // 欄位模板
    const schema = {
        "團隊密碼": "",
        "主要聯絡人": {
            "學號": "",
            "姓名": "",
            "信箱": ""
        },
        "夥伴一": {
            "學號": "",
            "姓名": "",
            "信箱": ""
        },
        "夥伴二": {
            "學號": "",
            "姓名": "",
            "信箱": ""
        }
    };

    // 檢查表單

    // 傳入空物件
    if(typeof(teamObject) === undefined) {
        return false;
    }
    // 用模板檢查欄位並對欄位做資料驗證
    for(let mainKey in schema) {
        // 針對成員資料驗證
        if(typeof(teamObject[mainKey]) === 'object') {
            for(let subKey in schema[mainKey]) {
                // 欄位不存在
                if(typeof(teamObject[mainKey][subKey]) === undefined || typeof(teamObject[mainKey][subKey]) === 'object' ) return false;
                switch(subKey) {
                    case '學號':
                        if(!verifyModule.id(teamObject[mainKey][subKey])) return false;
                        break;
                    case '姓名':
                        if(!verifyModule.name(teamObject[mainKey][subKey])) return false;
                        break;
                    case '信箱':
                        if(!verifyModule.email(teamObject[mainKey][subKey])) return false;
                        break;
                }
            }
        } else if(typeof(teamObject[mainKey]) === 'string') {
            // 密碼驗證
            if(typeof(teamObject[mainKey]) === undefined || !verifyModule.password(teamObject[mainKey])) {
                return false;
            }
        } else {
            return false;
        }
    }

    return true;
}

// 檢查資料重複

async function _verifyRepeat(database, teamObject) {
    // 比較使用者資料
    function userObjectCompare(baseUserObject, compareUserObject){
        for(let key in baseUserObject) {
            // 不檢查姓名重複
            if(key === '姓名') continue;
            // 其餘任何一筆重複就否決
            if(baseUserObject[key] === compareUserObject[key]) {
                return false;
            }
        }
        return true;
    }


    // 存放重複欄位
    let repeatUser = [];
    // 比較 Object Key
    let members = ['主要聯絡人', '夥伴一', '夥伴二'];

    if(!userObjectCompare(teamObject[members[0]], teamObject[members[1]]) || !userObjectCompare(teamObject[members[0]], teamObject[members[2]]) || !userObjectCompare(teamObject[members[1]], teamObject[members[2]])) {
        return false;
    }
    // 讀取 firestore 中資料比對
    await database.collection('teams').get()
    .then(snapshot => {
        for(let doc of snapshot.docs) {
            let teamRegObject = doc.data();
            for(let i = 0; i < members.length; i++) {
                for(let j = 0; j < members.length; j++) {
                    if(!userObjectCompare(teamObject[members[i]], teamRegObject[members[j]]) && !repeatUser.includes(members[j])) {
                        repeatUser.push(members[j]);
                    }
                }
            }
        }
    })
    .catch((error) => {
        console.log('Failed to get teams object. Error: ' + error);
        return 'Network Error';
    });

    if(repeatUser.length > 0) {
        return repeatUser;
    } else {
        return true;
    }
}

// 更新驗證狀態

async function _updateMailVerify(database, hashCode) {
    let members = ['主要聯絡人', '夥伴一', '夥伴二'];
    let flag = false;
    await database.collection('teams').get()
    .then(async (snapshot) => {
        for(let index in snapshot.docs) {
            let teamRegObject = snapshot.docs[index].data();
            for(let i = 0; i < members.length; i++) {
                if(teamRegObject[members[i]]['是否驗證'] === '是' && teamRegObject[members[i]]['信箱驗證'] === hashCode) {
                    flag = 'Already';
                    return;
                } else if(teamRegObject[members[i]]['是否驗證'] === '否' && teamRegObject[members[i]]['信箱驗證'] === hashCode) {
                    teamRegObject[members[i]]['是否驗證'] = '是';
                    await database.collection('teams').doc(snapshot.docs[index].id).update(teamRegObject);
                    flag = true;
                    return;
                }
            }
        }
        flag = false;
        return;
    })
    .catch((error) => {
        console.log('Failed to get teams object. Error: ' + error);
        flag = 'Network Error';
        return;
    });

    return flag;
}

// 寄出信件

async function _mailSender(mailArray, hashArray, teamKey, teamPassword) {
    for(let i = 0; i < mailArray.length; i++) {
        let transporter = nodemailer.createTransport(smtpConfig);

        let mailOptions = {
            from: "Secret_OS@ncnu.edu.tw",
            to: mailArray[i],
            subject: "MOLi x MysC 活動報名驗證信",
            text: "親愛的參與者您好，您可以透過 https://xn--pss23c41retm.tw/register/" + teamKey + " 查詢隊伍的信箱驗證狀態，以及點擊 https://xn--pss23c41retm.tw/_api/register/" + hashArray[i] + " 來驗證您的信箱，當三位參與者都已驗證後將於活動開始日 (5/20) 收到起始信件。您的隊伍密碼：" + teamPassword + "、您的隊伍編號：" + teamKey + "，MOLi x Mysc 團隊敬上",
            html: "親愛的參與者您好，<br> 您可以透過 <a href='https://xn--pss23c41retm.tw/register/" + teamKey + "'>此連結</a> 查詢隊伍的信箱驗證狀態，以及點擊 <a href='https://xn--pss23c41retm.tw/_api/register/" + hashArray[i] + "'>本處</a> 來驗證您的信箱，當三位參與者都已驗證後將於活動開始日 (5/20) 收到起始信件。<br/><br/>您的隊伍密碼：" + teamPassword + "<br/>您的隊伍編號：" + teamKey + "<br/><br/>MOLi x Mysc 團隊敬上"
        };

        await transporter.sendMail(mailOptions, function(error, response) {
            if(error) {
                console.log(error);
                return false;
            } else {
                console.log("Message sent to " + mailArray[i] + " success");
            }
        });
    }

    return true;
}

/* 信箱驗證 */

// [GET] 驗證信箱
router.get('/:mailHash', function(req, res, next) {
    let hashCode = req.params.mailHash;

    _updateMailVerify(req.database, hashCode)
    .then((result) => {
        if (result === 'Already') {
            res.status(403).send('<h3>您已經驗證過了</h3>');
        } else if (result === 'Network Error') {
            res.status(500).send('<h3>伺服器錯誤，請稍後再試</h3><br/>若無改善，請聯絡 MOLi 粉絲團');
        } else if(result) {
            res.status(200).send('<h3>驗證成功</h3>');
        } else {
            res.status(404).send('<h3>找不到該筆驗證碼</h3>');
        }
    });
});

// [POST] 新增報名
router.post('/', function(req, res, next) {
    let teamObject = req.body;
    if(_verifyTeamObject(teamObject)) {
        _verifyRepeat(req.database, teamObject)
        .then((response) => {
            if(Array.isArray(response)) {
                res.status(403).send({'error':'成員已註冊 (' + response.toString() + ')'});
            } else if(response === 'Network Error') {
                res.status(403).send({'error': response});
            } else if(!response) {
                res.status(403).send({'error': '報名成員中有資料重複'});
            } else {
                // 補充欄位
                teamPassword = teamObject['團隊密碼'];
                teamObject['團隊密碼'] = crypto.createHmac('sha512', salt).update(teamObject['團隊密碼']).digest().toString('hex');
                teamObject['卡號'] = '尚未建立';
                teamObject['主要聯絡人']['是否驗證'] = teamObject['夥伴一']['是否驗證'] = teamObject['夥伴二']['是否驗證'] = '否';
                teamObject['主要聯絡人']['信箱驗證'] = crypto.createHmac('sha512', salt).update(teamObject['主要聯絡人']['信箱']).digest().toString('hex');
                teamObject['夥伴一']['信箱驗證'] = crypto.createHmac('sha512', salt).update(teamObject['夥伴一']['信箱']).digest().toString('hex');
                teamObject['夥伴二']['信箱驗證'] = crypto.createHmac('sha512', salt).update(teamObject['夥伴二']['信箱']).digest().toString('hex');
                req.database.collection('teams').add(teamObject)
                .then( ref => {
                    _mailSender([teamObject['主要聯絡人']['信箱'], teamObject['夥伴一']['信箱'], teamObject['夥伴二']['信箱']], [crypto.createHmac('sha512', salt).update(teamObject['主要聯絡人']['信箱']).digest().toString('hex'), crypto.createHmac('sha512', salt).update(teamObject['夥伴一']['信箱']).digest().toString('hex'), crypto.createHmac('sha512', salt).update(teamObject['夥伴二']['信箱']).digest().toString('hex')], ref.id, teamPassword)
                    .then( success => {
                        if(success) {
                            res.status(200).send({'message':'報名完成，請所有成員至 email 信箱收取信件'});
                        } else {
                            res.status(403).send({'error':'系統錯誤，請聯絡主辦單位 MOLi 粉絲團 (無法寄送驗證信件)'});
                        }
                    })
                    .catch( error => {
                        console.log('Send verify mail error. Error: ' + error);
                        res.status(403).send({'error':'系統錯誤，請聯絡主辦單位 MOLi 粉絲團 (無法寄送驗證信件)'});
                    });
                })
                .catch( error => {
                    console.log('Update register data error. Error: ' + error)
                    res.status(403).send({'error':'系統錯誤 (無法上傳報名資料)'});
                });
            }
        });
    } else {
        res.status(403).send({'error':'缺少欄位'});
    }
});

module.exports = router;