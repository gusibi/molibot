百度 web_summary 搜索（fast）

=curl --location 'https://qianfan.baidubce.com/v2/ai_search/web_summary' \
--header 'X-Appbuilder-Authorization: Bearer <API Key\>' 
--header 'X-Appbuilder-Request-Id: a728c65f-840a-4769-a37f-5639a1ad8b1f' \
--header 'X-Appbuilder-User-Id: f96e262041644ce2a0670bdc57f3cd7b' \
--header 'Content-Type: application/json' \
--data '{"messages": [{"role": "user", "content": "北戴河景区"}],
"stream": true}'

{"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"北戴河景区位于河北省秦皇岛市西南部，南临渤海，北靠联峰山，地处燕山余脉与渤海交汇地带，是华北地区著名的滨海旅游与避暑胜地。作为中国四大避暑地之一，北戴河景区不仅自然风光秀美，而且历史文化底蕴深厚，兼具生态价值与旅游功能。\n\n### 一、地理与规划概况\n\n| 属性 | 信息 |\n|------|------|\n| 地理位置 | 河北省秦皇岛市西南部，南临渤海，北靠联峰山，东接辽宁，西连京津 |\n| 地理范围 | 地跨秦皇岛市四区三县，规划总面积约 **365.97 平方千米** |\n| 地形地貌 | 以海滨平原和低山丘陵为主，地质结构稳定，拥有典型海蚀地貌 |\n| 气候类型 | 暖温带半湿润大陆性季风气候，夏季凉爽宜人，年均气温约12℃ |\n\n\u003e **信息来源**：网页2、网页3、网页4\n\n---\n\n### 二、核心景区构成与功能分区\n\n北戴河景区属于**分散型风景区**，由六大特色景区构成，按地理方位自北向南划分为五大功能区域：\n\n1. **北部山林区域**：以联峰山为核心，植被茂密，为城市绿肺与生态屏障。\n2. **低山丘陵区域**：兼具自然景观与人文遗迹，如鸽子窝公园、老虎石公园等。\n3. **山间盆地区域**：地形相对封闭，适宜生态保育与休闲康养。\n4. **冲积平原区域**：地势平坦，是城市建设和农业活动的主要区域。\n5. **东部沿海区域**：拥有长达二十里的优质沙滩，是海滨度假的核心地带。\n\n**六大具体景区**包括：\n- 北戴河海滨风景区（核心）\n- 山海关（历史名城，长城起点）\n- 南戴河（以“海上乐园”著称）\n- 黄金海岸（国家级海洋公园）\n- 祖山（燕山山脉重要支脉，自然生态保护区）\n- 碣石山（古代帝王巡游之地，文化底蕴深厚）\n\n\u003e **信息来源**：网页2、网页3\n\n---\n\n### 三、生态与环境价值\n\n北戴河不仅是旅游胜地，更是重要的生态节点。其周边生态系统包括：\n- **滨海湿地系统**：如七里海潟湖，是东亚—澳大利西亚候鸟迁徙通道的关键中转站。\n- **海洋碳汇功能**：通过退养还湿、微地形改造、岸线修复等措施，七里海潟湖水面面积已恢复至2015年的**3倍**，显著提升区域碳汇能力。\n- **灾害预警体系**：已构建“空—天—地—海”一体化海洋灾害监测预警系统，增强防灾减灾能力。\n\n\u003e **信息来源**：网页1\n\n---\n\n### 四、旅游与文化地位\n\n北戴河景区享有极高声誉，曾获多项国家级荣誉：\n- 首批国家级重点风景名胜区\n- 首批全国旅游示范区\n- 中国优秀旅游城市\n- 全国文明城市\n- 国家森林城市\n\n同时，北戴河地处“京津冀黄金旅游圈”核心节点，与北京、天津、承德共同构成区域旅游联动网络，是国内外游客理想的休闲度假目的地。\n\n---\n\n### 五、未来发展方向\n\n随着生态文明建设深入推进，北戴河景区正从传统观光型向**生态旅游+智慧管理+可持续发展**转型：\n- 推进生态修复工程（如七里海潟湖恢复项目）\n- 强化智慧化监测与预警系统建设\n- 发展低碳旅游与绿色交通体系\n- 深化文化遗产保护与活化利用\n\n---\n\n### 总结\n\n北戴河景区集自然之美、历史之韵、生态之重于一体，既是避暑胜地，也是生态屏障与文化地标。其在地理区位、生态功能、旅游价值与政策支持方面均具备显著优势，未来将持续发挥京津冀协同发展中的重要支点作用。\n\n如需了解具体景区开放时间、门票信息或交通指南，可进一步查阅官方旅游平台或景区公告。"}}],"references":[{"id":1,"url":"https://i.ifeng.com/c/8oU2F1wG30G","title":"万鸟归来 七里海潟湖十年重生","date":"2025-10-12 00:00:00","content":"七里海潟湖位于秦皇岛市北戴河新区,是华北地区最大的潟湖、东亚—澳大利西亚候鸟迁徙通道的重要节点,也是我省提升海洋碳汇能力、增强海洋防灾减灾功能的重要海洋生态系统。 通过协议退养还湿、微地形改造、岸线修复等生态减灾修复措施,目前七里海潟湖水面面积恢复至2015年的3倍,同时构建起“空—天—地—海”一体化海洋灾害预警监测体系,区域生态功能得到改善,防灾减灾能力有效提升。 退养还湿 水面面积扩大至十年前的3倍 10月20日,秦皇岛市北戴河新区秋高气爽。","icon":"http://x0.ifengimg.com/fe/custom/ifeng.f52bd6.png","web_anchor":"","type":"web","website":"凤凰网","video":null,"image":null,"is_aladdin":false,"aladdin":null,"snippet":"七里海潟湖位于秦皇岛市北戴河新区,是华北地区最大的潟湖、东亚—澳大利西亚候鸟迁徙通道的重要节点,也是我省提升海洋碳汇能力、增强海洋防灾减灾功能的重要海洋生态系统。 通过协议退养还湿、微地形改造、岸线修复等生态减灾修复措施,目前七里海潟湖水面面积恢复至2015年的3倍,同时构建起“空—天—地—海”一体化海洋灾害预警监测体系,区域生态功能得到改善,防灾减灾能力有效提升。 退养还湿 水面面积扩大至十年前的3倍 10月20日,秦皇岛市北戴河新区秋高气爽。","web_extensions":{"images":null},"rerank_score":1,"authority_score":0.5},{"id":2,"url":"https://baike.baidu.com/item/北戴河景区/10433529","title":"北戴河景区","date":"2025-10-23 11:06:41","content":" 北戴河景区,位于河北省秦皇岛市西南部,南临渤海,北靠联峰山,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方千米。 [3] [6] [16] 北戴河景区的地形地貌以海滨平原和丘陵为主,地质结构稳定,拥有多处海蚀地貌。水文特征显著,毗邻渤海,海岸线绵长,海水清澈。气候类型为暖温带半湿润大陆性季风气候。植被类型包括温带落叶阔叶林及沿海盐生植被。生物资源包括多种海洋生物和内陆野生动物。北戴河景区属于分散型风景区,包含六大特色景区。景区由北向南划分为五大区域:北部山林区域、低山丘陵区域、山间盆地区域、冲积平原区域和东部沿海区域。景区还包括山海关、北戴河、南戴河、黄金海岸、祖山和碣石山六大具体景区。 [7] 北戴河景区是中国四大避暑地之一,先后被评为首批国家级重点风景名胜区、首批全国旅游示范区、中国优秀旅游城市,荣获全国文明城市、国家森林城市桂冠。","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河景区,位于河北省秦皇岛市西南部,南临渤海,北靠联峰山,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方千米。 [3] [6] [16] 北戴河景区的地形地貌以海滨平原和丘陵为主,地质结构稳定,拥有多处海蚀地貌。水文特征显著,毗邻渤海,海岸线绵长,海水清澈。气候类型为暖温带半湿润大陆性季风气候。植被类型包括温带落叶阔叶林及沿海盐生植被。生物资源包括多种海洋生物和内陆野生动物。北戴河景区属于分散型风景区,包含六大特色景区。景区由北向南划分为五大区域:北部山林区域、低山丘陵区域、山间盆地区域、冲积平原区域和东部沿海区域。景区还包括山海关、北戴河、南戴河、黄金海岸、祖山和碣石山六大具体景区。 [7] 北戴河景区是中国四大避暑地之一,先后被评为首批国家级重点风景名胜区、首批全国旅游示范区、中国优秀旅游城市,荣获全国文明城市、国家森林城市桂冠。","web_extensions":{"images":[{"url":"https://bkimg.cdn.bcebos.com/pic/2934349b033b5bb5ab25ff723cd3d539b700bc48","height":"450","width":"600"},{"url":"https://bkimg.cdn.bcebos.com/pic/08f790529822720e9dda7f477dcb0a46f21fab73","height":"492","width":"779"},{"url":"https://bkimg.cdn.bcebos.com/pic/f29faa8fe1e485aaf11f3651","height":"274","width":"400"},{"url":"https://bkimg.cdn.bcebos.com/pic/3812b31bb051f8196d4316fbdab44aed2e73e719","height":"600","width":"800"},{"url":"https://bkimg.cdn.bcebos.com/pic/0d729944ce3d0b08500ffe2e","height":"329","width":"453"}]},"rerank_score":1,"authority_score":1},{"id":3,"url":"https://baike.baidu.com/item/北戴河风景名胜区/6749014","title":"北戴河风景名胜区","date":"2025-10-21 16:29:05","content":" 北戴河风景名胜区因为它拥有避暑胜地北戴河、历史名城山海关和天然不冻良港而驰名天下。 秦皇岛北戴河风景名胜区位于渤海之滨,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方公里,是我国第一批国家重点风景名胜区之一。 北戴河风景名胜区位于河北省秦皇岛市西南,南临渤海,北靠联峰山。","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河风景名胜区因为它拥有避暑胜地北戴河、历史名城山海关和天然不冻良港而驰名天下。 秦皇岛北戴河风景名胜区位于渤海之滨,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方公里,是我国第一批国家重点风景名胜区之一。 北戴河风景名胜区位于河北省秦皇岛市西南,南临渤海,北靠联峰山。","web_extensions":{"images":[{"url":"https://bkimg.cdn.bcebos.com/pic/562c11dfa9ec8a131b0ac69cf903918fa0ecc0be","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/d8f9d72a6059252d009a5041319b033b5ab5b9e2","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/4ec2d5628535e5dd8ebf8f6e76c6a7efcf1b62eb","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/42166d224f4a20a47817f53f90529822720ed039","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/d01373f082025aaf51f2b033fbedab64024f1a02","height":"0","width":"0"}]},"rerank_score":1,"authority_score":1},{"id":4,"url":"https://baike.baidu.com/item/北戴河海滨风景区/3233396","title":"北戴河海滨风景区","date":"2025-03-04 15:08:06","content":" 北戴河海滨风景区地处河北省秦皇岛市中心的西部。是秦皇岛的城市区之一,气候宜人,二十里长、曲折平坦的沙质海滩,沙软潮平,背靠树木葱郁的联峰山,自然环境优美。与北京、天津、承德共同构成京津冀黄金旅游圈,北戴河处于旅游圈的重要节点地位。北戴河海滨风景区,中国著名海滨避暑胜地,拥有优质海滩、丰富自然与人文景观,适合休闲度假、观海赏日及体验渔家生活。 南京汤山温泉旅游度假区 南京汤山温泉旅游度假区位于南京市江宁区东部,区域面积29.74平方公里,2007年启动汤山新城建设,2012年","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河海滨风景区地处河北省秦皇岛市中心的西部。是秦皇岛的城市区之一,气候宜人,二十里长、曲折平坦的沙质海滩,沙软潮平,背靠树木葱郁的联峰山,自然环境优美。与北京、天津、承德共同构成京津冀黄金旅游圈,北戴河处于旅游圈的重要节点地位。北戴河海滨风景区,中国著名海滨避暑胜地,拥有优质海滩、丰富自然与人文景观,适合休闲度假、观海赏日及体验渔家生活。 南京汤山温泉旅游度假区 南京汤山温泉旅游度假区位于南京市江宁区东部,区域面积29.74平方公里,2007年启动汤山新城建设,2012年","web_extensions":{"images":null},"rerank_score":1,"authority_score":1}]}
\`\`\`
<br>

#### 流式
\`\`\`
data: {"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":null,"references":[{"id":1,"url":"https://i.ifeng.com/c/8oU2F1wG30G","title":"万鸟归来 七里海潟湖十年重生","date":"2025-10-12 00:00:00","content":"七里海潟湖位于秦皇岛市北戴河新区,是华北地区最大的潟湖、东亚—澳大利西亚候鸟迁徙通道的重要节点,也是我省提升海洋碳汇能力、增强海洋防灾减灾功能的重要海洋生态系统。 通过协议退养还湿、微地形改造、岸线修复等生态减灾修复措施,目前七里海潟湖水面面积恢复至2015年的3倍,同时构建起“空—天—地—海”一体化海洋灾害预警监测体系,区域生态功能得到改善,防灾减灾能力有效提升。 退养还湿 水面面积扩大至十年前的3倍 10月20日,秦皇岛市北戴河新区秋高气爽。","icon":"http://x0.ifengimg.com/fe/custom/ifeng.f52bd6.png","web_anchor":"","type":"web","website":"凤凰网","video":null,"image":null,"is_aladdin":false,"aladdin":null,"snippet":"七里海潟湖位于秦皇岛市北戴河新区,是华北地区最大的潟湖、东亚—澳大利西亚候鸟迁徙通道的重要节点,也是我省提升海洋碳汇能力、增强海洋防灾减灾功能的重要海洋生态系统。 通过协议退养还湿、微地形改造、岸线修复等生态减灾修复措施,目前七里海潟湖水面面积恢复至2015年的3倍,同时构建起“空—天—地—海”一体化海洋灾害预警监测体系,区域生态功能得到改善,防灾减灾能力有效提升。 退养还湿 水面面积扩大至十年前的3倍 10月20日,秦皇岛市北戴河新区秋高气爽。","web_extensions":{"images":null},"rerank_score":1,"authority_score":0.5},{"id":2,"url":"https://baike.baidu.com/item/北戴河景区/10433529","title":"北戴河景区","date":"2025-10-23 11:06:41","content":" 北戴河景区,位于河北省秦皇岛市西南部,南临渤海,北靠联峰山,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方千米。 [3] [6] [16] 北戴河景区的地形地貌以海滨平原和丘陵为主,地质结构稳定,拥有多处海蚀地貌。水文特征显著,毗邻渤海,海岸线绵长,海水清澈。气候类型为暖温带半湿润大陆性季风气候。植被类型包括温带落叶阔叶林及沿海盐生植被。生物资源包括多种海洋生物和内陆野生动物。北戴河景区属于分散型风景区,包含六大特色景区。景区由北向南划分为五大区域:北部山林区域、低山丘陵区域、山间盆地区域、冲积平原区域和东部沿海区域。景区还包括山海关、北戴河、南戴河、黄金海岸、祖山和碣石山六大具体景区。 [7] 北戴河景区是中国四大避暑地之一,先后被评为首批国家级重点风景名胜区、首批全国旅游示范区、中国优秀旅游城市,荣获全国文明城市、国家森林城市桂冠。","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河景区,位于河北省秦皇岛市西南部,南临渤海,北靠联峰山,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方千米。 [3] [6] [16] 北戴河景区的地形地貌以海滨平原和丘陵为主,地质结构稳定,拥有多处海蚀地貌。水文特征显著,毗邻渤海,海岸线绵长,海水清澈。气候类型为暖温带半湿润大陆性季风气候。植被类型包括温带落叶阔叶林及沿海盐生植被。生物资源包括多种海洋生物和内陆野生动物。北戴河景区属于分散型风景区,包含六大特色景区。景区由北向南划分为五大区域:北部山林区域、低山丘陵区域、山间盆地区域、冲积平原区域和东部沿海区域。景区还包括山海关、北戴河、南戴河、黄金海岸、祖山和碣石山六大具体景区。 [7] 北戴河景区是中国四大避暑地之一,先后被评为首批国家级重点风景名胜区、首批全国旅游示范区、中国优秀旅游城市,荣获全国文明城市、国家森林城市桂冠。","web_extensions":{"images":[{"url":"https://bkimg.cdn.bcebos.com/pic/2934349b033b5bb5ab25ff723cd3d539b700bc48","height":"450","width":"600"},{"url":"https://bkimg.cdn.bcebos.com/pic/08f790529822720e9dda7f477dcb0a46f21fab73","height":"492","width":"779"},{"url":"https://bkimg.cdn.bcebos.com/pic/f29faa8fe1e485aaf11f3651","height":"274","width":"400"},{"url":"https://bkimg.cdn.bcebos.com/pic/3812b31bb051f8196d4316fbdab44aed2e73e719","height":"600","width":"800"},{"url":"https://bkimg.cdn.bcebos.com/pic/0d729944ce3d0b08500ffe2e","height":"329","width":"453"}]},"rerank_score":1,"authority_score":1},{"id":3,"url":"https://baike.baidu.com/item/北戴河风景名胜区/6749014","title":"北戴河风景名胜区","date":"2025-10-21 16:29:05","content":" 北戴河风景名胜区因为它拥有避暑胜地北戴河、历史名城山海关和天然不冻良港而驰名天下。 秦皇岛北戴河风景名胜区位于渤海之滨,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方公里,是我国第一批国家重点风景名胜区之一。 北戴河风景名胜区位于河北省秦皇岛市西南,南临渤海,北靠联峰山。","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河风景名胜区因为它拥有避暑胜地北戴河、历史名城山海关和天然不冻良港而驰名天下。 秦皇岛北戴河风景名胜区位于渤海之滨,东临辽宁、西接京津,北枕燕山,地跨秦皇岛市的四区三县,规划总面积约为365.97平方公里,是我国第一批国家重点风景名胜区之一。 北戴河风景名胜区位于河北省秦皇岛市西南,南临渤海,北靠联峰山。","web_extensions":{"images":[{"url":"https://bkimg.cdn.bcebos.com/pic/562c11dfa9ec8a131b0ac69cf903918fa0ecc0be","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/d8f9d72a6059252d009a5041319b033b5ab5b9e2","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/4ec2d5628535e5dd8ebf8f6e76c6a7efcf1b62eb","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/42166d224f4a20a47817f53f90529822720ed039","height":"0","width":"0"},{"url":"https://bkimg.cdn.bcebos.com/pic/d01373f082025aaf51f2b033fbedab64024f1a02","height":"0","width":"0"}]},"rerank_score":1,"authority_score":1},{"id":4,"url":"https://baike.baidu.com/item/北戴河海滨风景区/3233396","title":"北戴河海滨风景区","date":"2025-03-04 15:08:06","content":" 北戴河海滨风景区地处河北省秦皇岛市中心的西部。是秦皇岛的城市区之一,气候宜人,二十里长、曲折平坦的沙质海滩,沙软潮平,背靠树木葱郁的联峰山,自然环境优美。与北京、天津、承德共同构成京津冀黄金旅游圈,北戴河处于旅游圈的重要节点地位。北戴河海滨风景区,中国著名海滨避暑胜地,拥有优质海滩、丰富自然与人文景观,适合休闲度假、观海赏日及体验渔家生活。 南京汤山温泉旅游度假区 南京汤山温泉旅游度假区位于南京市江宁区东部,区域面积29.74平方公里,2007年启动汤山新城建设,2012年","icon":"https://mbs1.bdstatic.com/searchbox/mappconsole/image/20200630/db4d874a-872b-4b27-931d-775a91ed0003.png","web_anchor":"","type":"web","website":"百度百科","video":null,"image":null,"is_aladdin":true,"aladdin":null,"snippet":" 北戴河海滨风景区地处河北省秦皇岛市中心的西部。是秦皇岛的城市区之一,气候宜人,二十里长、曲折平坦的沙质海滩,沙软潮平,背靠树木葱郁的联峰山,自然环境优美。与北京、天津、承德共同构成京津冀黄金旅游圈,北戴河处于旅游圈的重要节点地位。北戴河海滨风景区,中国著名海滨避暑胜地,拥有优质海滩、丰富自然与人文景观,适合休闲度假、观海赏日及体验渔家生活。 南京汤山温泉旅游度假区 南京汤山温泉旅游度假区位于南京市江宁区东部,区域面积29.74平方公里,2007年启动汤山新城建设,2012年","web_extensions":{"images":null},"rerank_score":1,"authority_score":1}]}

data: {"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":[{"finish_reason":"","delta":{"role":"assistant","content":"北"}}]}

data: {"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":[{"finish_reason":"","delta":{"role":"","content":"戴"}}]}

data: {"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":[{"finish_reason":"","delta":{"role":"","content":"河"}}]}

data: {"request_id":"a728c65f-840a-4769-a37f-5639a1ad8b1f","choices":[{"finish_reason":"","delta":{"role":"","content":"景区"}}]}

...

百度 web_search 搜索 每日 1000 次

curl --location 'https://qianfan.baidubce.com/v2/ai_search/web_search' \
--header 'X-Appbuilder-Authorization: Bearer <AppBuilder API Key>' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [
    {
      "content": "百度千帆平台",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v2",
  "resource_type_filter": [{"type": "web","top_k": 10}]
}'

{
    "references": [
        {
            "content": "河北天气预报,及时准确发布中央气象台天气信息,便捷查询河北今日天气\u0004,河北周末天气,河北一周天气预报,河北蓝天预报,河北天气预报,河北40日天气预报,还\u0005提供河北的生活指数、健康指数、交通...",
            "date": "2025-04-27 18:02:00",
            "icon": null,
            "id": 1,
            "image": null,
            "title": "【河北天气】河北天气预报,蓝天,蓝天预报,雾霾,雾霾...",
            "type": "web",
            "url": "https://www.weather.com.cn/html/weather/101031600.shtml",
            "video": null,
            "web_anchor": "【河北天气】河北天气预报,蓝天,蓝天预报,雾霾,雾霾..."
        },
        {
            "content": "保定天气预报,及时准确发布中央气象台天气信息,便捷查询保定今日天气,保定周末天气,保定一周天气预报,保定蓝天预报,保定天气预报,保定40日天气预报,还提供保定的生活指数、健康指数、交通...",
            "date": "2025-05-20 11:58:00",
            "icon": null,
            "id": 2,
            "image": null,
            "title": "保定天气预报,保定7天天气预报,保定15天天气预报,保定...",
            "type": "web",
            "url": "https://www.weather.com.cn/weather/101090201.shtml",
            "video": null,
            "web_anchor": "保定天气预报,保定7天天气预报,保定15天天气预报,保定..."
        },
        {
            "content": "河北省气象台2025年05月23日11时发布天气预报: 今天下午到夜间,保定西部、石家庄西部、邢台西部阴有小雨或零星小雨转晴,其他地区阴转晴。最高气温,张家口、承德北部、保定西北部13～17...",
            "date": "2025-05-23 00:00:00",
            "icon": null,
            "id": 3,
            "image": null,
            "title": "今天西部部分地区仍有降水 其它地区阴转晴-河北首页...",
            "type": "web",
            "url": "http://hebei.weather.com.cn/tqxs/4190923_m.shtml",
            "video": null,
            "web_anchor": "今天西部部分地区仍有降水 其它地区阴转晴-河北首页..."
        },
        {
            "content": "河北省气象台2025年05月22日05时发布天气预报 今天白天,保定、廊坊及以北地区阴有小雨或阵雨,其中张家口、保定西北部有中到大雨;其他地区多云转阴有小雨或阵雨,其中邯郸大部有中雨。...",
            "date": "2025-05-22 09:07:22",
            "icon": null,
            "id": 4,
            "image": null,
            "title": "今天白天到夜间,我省大部分地区有降水-河北首页-中国...",
            "type": "web",
            "url": "http://hebei.weather.com.cn/tqxs/4189523_m.shtml",
            "video": null,
            "web_anchor": "今天白天到夜间,我省大部分地区有降水-河北首页-中国..."
        }
    ],
    "request_id": "ca749cb1-26db-4ff6-9735-f7b472d59003"
}

百度 search slow search

请求示例

curl --location 'https://qianfan.baidubce.com/v2/ai_search/chat/completions' \
--header 'X-Appbuilder-Authorization: Bearer <API Key>' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [
    {
      "content": "北京有哪些景点",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v1",
  "resource_type_filter": [
      {"type": "image","top_k": 4},
      {"type": "video","top_k": 4},
      {"type": "web","top_k": 4}
  ],
  "search_recency_filter": "year",
  "stream": false,
  "model": "ernie-4.5-turbo-32k",
  "enable_deep_search": false,
  "enable_followup_query": false,
  "temperature": 0.11,
  "top_p": 0.55,
  "search_mode": "auto",
  "enable_reasoning": true
}'

响应示例

{
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "message": {
                "content": "北京的景点非常丰富，其中包括：\n1. 故宫博物院（紫禁城）：是世界上现存规模最大、保存最为完整的木质结构古建筑群之一，也是明清两代的皇家宫殿。\n2. 八达岭长城：是万里长城的重要组成部分，也是明长城的一个隘口，雄伟壮观，历史底蕴深厚。\n3. 颐和园：是清朝时期的皇家园林，以昆明湖、万寿山为基址，以杭州西湖为蓝本，汲取江南园林的设计手法而建成的一座大型山水园林，被誉为“皇家园林博物馆”。\n4. 北京天安门广场：是世界最大的城市广场，见证了许多重大历史时刻。\n5. 天坛公园：是明清皇帝祭天的地方，建筑独特，寓意“天圆地方”。\n6. 圆明园：是清代大型皇家园林，虽遭破坏，但仍能感受到昔日的辉煌与沧桑。\n7. 香山公园：是北京西郊的山林公园，景色秀丽，秋季红叶更是美不胜收。\n8. 恭王府：是规模宏大的王府建筑群，建筑精美。\n9. 什刹海：包括前海、后海等，有老北京的韵味，可乘船赏景。\n10. 奥林匹克公园：体现了“科技、绿色、人文”的理念，有鸟巢、水立方等标志性建筑。\n\n除了这些，北京还有许多其他值得一游的景点，如法海寺、龙庆峡、古北水镇、红螺寺等。",
                "role": "assistant"
            }
        }
    ],
    "is_safe": true,
    "references": [
        {
            "content": "1. 故宫（紫禁城）地址：东城区景山前街4号。门票：60元（旺季）/40元（淡季）开放时间：8:30-17:00（周一闭馆）。 为什么必去？故宫是世界现存最大、最完整的木质结构古建筑群，600年明清皇家历史的见证者，每一砖一瓦都藏着故事。必玩体验：中轴线游览（太和殿、乾清宫、御花园）感受皇家气派。打卡网红角落：延禧宫的西洋楼、红墙拍照（建议穿汉服）。珍宝馆+钟表馆（另收费），...",
            "date": "2025-4-24",
            "icon": "https://pic.rmb.bdstatic.com/bjh/user/f1c77bf4fc9f3651df29e52acde36e94.jpeg",
            "id": 1,
            "image": null,
            "title": "北京必玩景点TOP10|2025最新攻略,带你玩转帝都!",
            "type": "web",
            "url": "https://baijiahao.baidu.com/s?id=1830291819430711070&wfr=spider&for=pc",
            "video": null,
            "web_anchor": "老六爱玩"
        },
        {
            "content": "北京景点攻略 如果你是第一次去北京旅游可要千万要收藏好了",
            "date": "2024-06-01 03:18",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 2,
            "image": {
                "height": "674",
                "url": "http://img0.baidu.com/it/u=1145656209,2145532403&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=674",
                "width": "500"
            },
            "title": "北京景点攻略 如果你是第一次去北京旅游可要千万要收藏好了",
            "type": "image",
            "url": "http://mbd.baidu.com/newspage/data/dtlandingsuper?nid=dt_5388334462984511033",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "哪些北京京郊的景点 外地同学值得自驾车去 跟着UP主出行看世界 /生活/出行/北京旅游避坑指南/北京去哪玩好/干货实用攻略/自驾游北京攻略/亲子游/周边游/周末去哪玩/北京旅游攻略/保姆级攻略 哪些北京京郊景点值得外地同学自驾车去 北京公义 大八山面 北京京郊大部分景点都在六环外 办理六环外的进京证就行 当然您要办理六环内的更好一些 下面就给您推荐一些京郊自驾游 外地同学值得去的景点(北京同学也值...",
            "date": "2025-5-23",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/bilibili.ico",
            "id": 3,
            "image": null,
            "title": "哪些北京京郊的景点 外地同学值得自驾车去",
            "type": "web",
            "url": "https://www.bilibili.com/video/BV1hE421K7K1",
            "video": null,
            "web_anchor": "哔哩哔哩"
        },
        {
            "content": "北京旅游必去的十大景点推荐",
            "date": "2024-06-19 13:00",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 4,
            "image": {
                "height": "1067",
                "url": "http://img2.baidu.com/it/u=80406124,3208002747&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1067",
                "width": "800"
            },
            "title": "北京旅游必去的十大景点推荐",
            "type": "image",
            "url": "http://www.douyin.com/note/7382074689126010131",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "北京景区排名必玩十大景点?有世界最大城市广场,有大型皇家园林 北京景区排名必玩十大景点?有世界最大城市广场,有大型皇家园林 北京景区 城市广场 旅游攻略 旅游资讯 皇家园林 北京有很多值得一去的景点推荐10个:1.故宫: 位于北京中心明清皇宫建筑辉煌藏品丰富 尽显皇家风范 2.颐和园 清朝皇家园林有山有水融合江南园林风格 风景如画 3.八达岭长城:在延庆万里长城重要部分 雄伟壮观历史底蕴深厚 4....",
            "date": "2025-5-22",
            "icon": "https://ss0.baidu.com/6ONWsjip0QIZ8tyhnq/it/u=76251347,1123177279&fm=195&app=88&f=PNG?w=200&h=200",
            "id": 5,
            "image": null,
            "title": "北京景区排名必玩十大景点?有世界最大城市广场,有大型...",
            "type": "web",
            "url": "https://haokan.baidu.com/v?pd=wisenatural&vid=14103857872992752240",
            "video": null,
            "web_anchor": "好看视频"
        },
        {
            "content": "北京必去十大景点 新手必看‼️附旅游攻略.熬夜整理出来的必打",
            "date": "2024-06-15 20:25",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 6,
            "image": {
                "height": "1342",
                "url": "http://img1.baidu.com/it/u=17130128,3218194790&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1342",
                "width": "800"
            },
            "title": "北京必去十大景点 新手必看‼附旅游攻略.熬夜整理出来的必打",
            "type": "image",
            "url": "http://www.douyin.com/note/7380319151006436646",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "揭秘！北京好玩的十大景点排行榜，你去过几个？北京，这座古老又现代的城市，藏着无数好玩的地方。想知道哪些景点能跻身北京好玩的地方排行榜前十名吗？接下来，我们就为你揭开谜底，带你领略京城最值得一去的精华景点，让你的北京之行不留遗憾。1. 故宫博物院 故宫，旧称紫禁城，是中国明清两代的皇家宫殿，也是世界上现存规模最大、保存最为完整的木质结构古建筑群之一。走进故宫，仿佛穿越回了古代，红墙黄瓦、飞檐斗拱，处...",
            "date": "2025-5-4",
            "icon": "https://pic.rmb.bdstatic.com/bjh/user/84f5641182eb2b574909828a3fa8f9b0.jpeg",
            "id": 7,
            "image": null,
            "title": "揭秘!北京好玩的十大景点排行榜,你去过几个?",
            "type": "web",
            "url": "https://baijiahao.baidu.com/s?id=1830726637146162329&wfr=spider&for=pc",
            "video": null,
            "web_anchor": "炫拍客旅途志"
        },
        {
            "content": "北京必去十大景点新手必看.亲亲记滴点赞收藏! 1 no.1",
            "date": "2024-08-17 11:00",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 8,
            "image": {
                "height": "1067",
                "url": "http://img0.baidu.com/it/u=3343386837,4291065808&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1067",
                "width": "800"
            },
            "title": "北京必去十大景点新手必看.亲亲记滴点赞收藏! 1 no.1",
            "type": "image",
            "url": "http://www.douyin.com/note/7403937889005882650",
            "video": null,
            "web_anchor": "全网资源"
        }
    ],
    "request_id": "ad524989-be46-48fd-b2ec-344683b28305",
    "usage": {
        "completion_tokens": 295,
        "prompt_tokens": 1919,
        "total_tokens": 2214
    }
}



bocha 搜索  https://bocha-ai.feishu.cn/wiki/HmtOw1z6vik14Fkdu5uc9VaInBb

从全网搜索任何网页信息和网页链接，结果准确、摘要完整，更适合AI使用。支持设置搜索的时间范围(freshness)，可输出干净的长文本摘要(summary)。

curl -X POST "https://api.bocha.cn/v1/web-search" \
  -H "Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "天空为什么是蓝色的？",
    "freshness": "noLimit",
    "summary": true,
    "count": 10
  }'

{
  "code": 200,
  "log_id": "0d0eb34abc6eec9d",
  "msg": null,
  "data": {
    "_type": "SearchResponse",
    "queryContext": {
      "originalQuery": "天空为什么是蓝色的？"
    },
    "webPages": {
      "webSearchUrl": "https://bochaai.com/search?q=天空为什么是蓝色的？",
      "totalEstimatedMatches": 1618000,
      "value": [
        {
          "id": "1",
          "name": "天空为什么是蓝色的？科学原理解析",
          "url": "https://example.com/why-is-sky-blue",
          "displayUrl": "https://example.com/why-is-sky-blue",
          "snippet": "天空呈现蓝色是由于太阳光进入大气层后，波长较短的蓝光被大气分子散射...",
          "summary": "本文详细解释了瑞利散射原理：太阳光中蓝光波长较短，更容易被大气分子散射，因此我们看到的天空呈现蓝色。",
          "siteName": "科普中国",
          "siteIcon": "https://example.com/favicon.ico",
          "datePublished": "2024-03-15T10:30:00Z",
          "dateLastCrawled": "2025-06-01T08:00:00Z",
          "cachedPageUrl": "https://cc.bingj.com/cache.aspx?d=...",
          "language": "zh-cn",
          "isFamilyFriendly": true
        }
      ]
    }
  }
}

Brave Search API 文档: https://brave.com/search/api/

curl -G "https://api.search.brave.com/res/v1/web/search" \
  --data-urlencode "q=machine learning" \
  -d "country=US" \
  -d "search_lang=en" \
  -d "ui_lang=en-US" \
  -d "count=20" \
  -d "offset=0" \
  -d "safesearch=moderate" \
  -d "freshness=pw" \
  -d "spellcheck=true" \
  -d "extra_snippets=true" \
  -d "enable_rich_callback=1" \
  -d "summary=true" \
  -d "result_filter=web,news,videos,locations" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: YOUR_API_KEY_HERE"

核心参数说明基础搜索参数

q: 用户的搜索词（必填），最多 400 个字符或 50 个单词 。

country / search_lang / ui_lang: 区域化设置，分别用于指定国家代码（如 US）、网页内容语言（如 en）和响应界面元数据的偏好语言（如 en-US）。

safesearch: 成人内容过滤级别，支持 off（关闭）、moderate（适度，过滤显式媒体但保留域名）或 strict（严格过滤）。

分页与时间限制

count / offset: 用于结果分页。count 单页最多返回 20 条，offset 最大支持跳过 9 页 。官方建议在请求下一页前，检查返回 JSON 中的 more_results_available 字段以避免无效调用 。

freshness: 根据内容发布时间过滤，如 pd（过去24小时）、pw（过去7天）、pm（过去31天）、py（过去一年），也支持自定义时间段（如 2022-04-01to2022-07-30）。

内容增强与过滤

extra_snippets: 设为 true 时，除了主摘要，每个网页结果将额外包含最多 5 个相关的内容片段（Snippets），帮助提供更多上下文 。

spellcheck: 是否开启查询词拼写检查修正 。

result_filter: 逗号分隔的字符串，用于筛选特定的搜索结果块类型，可用值包括 web, news, videos, locations, faq, discussions 等 。

富数据与摘要特性

enable_rich_callback: 设为 1 时开启富数据回调。如果用户查询天气或股票等明确意图，API 会返回一个 callback_key，需要你拿着这个 key 发起二次请求去换取具体数据 。

summary: 设为 true 会生成摘要关联键，开启 AI Summarizer 功能时通常需要此参数 。

认证头: 必须在请求头中携带 -H "X-Subscription-Token: <YOUR_API_KEY>" 进行身份验证 。

{
  "type": "search",
  "query": {
    "original": "<string>",
    "show_strict_warning": false,
    "altered": "<string>",
    "cleaned": "<string>",
    "safesearch": false,
    "is_navigational": false,
    "is_geolocal": false,
    "local_decision": "<string>",
    "local_locations_idx": 0,
    "is_trending": false,
    "is_news_breaking": false,
    "ask_for_location": false,
    "language": {
      "main": "<string>"
    },
    "spellcheck_off": false,
    "country": "<string>",
    "bad_results": false,
    "should_fallback": false,
    "lat": "<string>",
    "long": "<string>",
    "postal_code": "<string>",
    "city": "<string>",
    "header_country": "<string>",
    "more_results_available": false,
    "state": "<string>",
    "custom_location_label": "<string>",
    "reddit_cluster": "<string>",
    "summary_key": "<string>",
    "search_operators": {
      "applied": false,
      "cleaned_query": "<string>",
      "sites": [
        "<string>"
      ]
    }
  },
  "discussions": {
    "type": "search",
    "results": [
      {
        "title": "<string>",
        "url": "<string>",
        "is_source_local": false,
        "is_source_both": false,
        "description": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "profile": {
          "name": "<string>",
          "url": "<string>",
          "long_name": "<string>",
          "img": "<string>"
        },
        "language": "<string>",
        "family_friendly": false,
        "type": "discussion",
        "subtype": "<string>",
        "is_live": false,
        "deep_results": {
          "news": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {},
              "source": "<string>",
              "breaking": false,
              "is_live": false,
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "age": "<string>",
              "extra_snippets": [
                "<string>"
              ],
              "icons": [
                {
                  "href": "<string>",
                  "sizes": "<string>",
                  "rel": "<string>",
                  "type": "<string>",
                  "ext": "<string>"
                }
              ]
            }
          ],
          "buttons": [
            {
              "type": "button_result",
              "title": "<string>",
              "url": "<string>"
            }
          ],
          "videos": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "type": "video_result",
              "video": {
                "duration": "<string>",
                "views": "<string>",
                "creator": "<string>",
                "publisher": "<string>",
                "thumbnail": {
                  "src": "<string>",
                  "alt": "<string>",
                  "height": 0,
                  "width": 0,
                  "bg_color": "<string>",
                  "original": "<string>",
                  "logo": false,
                  "duplicated": false,
                  "theme": "<string>"
                },
                "tags": [
                  "<string>"
                ],
                "author": {
                  "name": "<string>",
                  "url": "<string>",
                  "long_name": "<string>",
                  "img": "<string>"
                },
                "requires_subscription": false
              },
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              },
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "age": "<string>",
              "publisher": "<string>"
            }
          ],
          "images": [
            {
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "url": "<string>",
              "properties": {
                "url": "<string>",
                "resized": "<string>",
                "placeholder": "<string>",
                "height": 0,
                "width": 0,
                "format": "<string>",
                "content_size": "<string>"
              }
            }
          ]
        },
        "schemas": [],
        "meta_url": {},
        "thumbnail": {
          "src": "<string>",
          "alt": "<string>",
          "height": 0,
          "width": 0,
          "bg_color": "<string>",
          "original": "<string>",
          "logo": false,
          "duplicated": false,
          "theme": "<string>"
        },
        "age": "<string>",
        "location": {
          "title": "<string>",
          "url": "<string>",
          "is_source_local": false,
          "is_source_both": false,
          "description": "<string>",
          "page_age": "<string>",
          "page_fetched": "<string>",
          "fetched_content_timestamp": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "language": "<string>",
          "family_friendly": false,
          "type": "location_result",
          "provider_url": "<string>",
          "coordinates": [],
          "zoom_level": 0,
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "postal_address": {
            "type": "PostalAddress",
            "country": "<string>",
            "postalCode": "<string>",
            "streetAddress": "<string>",
            "addressRegion": "<string>",
            "addressLocality": "<string>",
            "displayAddress": "<string>"
          },
          "opening_hours": {
            "current_day": [
              {
                "abbr_name": "<string>",
                "full_name": "<string>",
                "opens": "<string>",
                "closes": "<string>"
              }
            ],
            "days": [
              [
                {
                  "abbr_name": "<string>",
                  "full_name": "<string>",
                  "opens": "<string>",
                  "closes": "<string>"
                }
              ]
            ]
          },
          "contact": {
            "email": "<string>",
            "telephone": "<string>"
          },
          "price_range": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "distance": {
            "value": 0,
            "units": "<string>"
          },
          "profiles": [
            {
              "type": "external",
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            }
          ],
          
          "action": {
            "type": "<string>",
            "url": "<string>"
          },
          "serves_cuisine": [
            "<string>"
          ],
          "categories": [
            "<string>"
          ],
          "icon_category": "<string>",
          "timezone": "<string>",
          "timezone_offset": 0,
          "id": "<string>",
          "results": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "restaurant": {
          "title": "<string>",
          "url": "<string>",
          "is_source_local": false,
          "is_source_both": false,
          "description": "<string>",
          "page_age": "<string>",
          "page_fetched": "<string>",
          "fetched_content_timestamp": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "language": "<string>",
          "family_friendly": false,
          "type": "location_result",
          "provider_url": "<string>",
          "coordinates": [],
          "zoom_level": 0,
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "postal_address": {
            "type": "PostalAddress",
            "country": "<string>",
            "postalCode": "<string>",
            "streetAddress": "<string>",
            "addressRegion": "<string>",
            "addressLocality": "<string>",
            "displayAddress": "<string>"
          },
          "opening_hours": {
            "current_day": [
              {
                "abbr_name": "<string>",
                "full_name": "<string>",
                "opens": "<string>",
                "closes": "<string>"
              }
            ],
            "days": [
              [
                {
                  "abbr_name": "<string>",
                  "full_name": "<string>",
                  "opens": "<string>",
                  "closes": "<string>"
                }
              ]
            ]
          },
          "contact": {
            "email": "<string>",
            "telephone": "<string>"
          },
          "price_range": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "distance": {
            "value": 0,
            "units": "<string>"
          },
          "profiles": [
            {
              "type": "external",
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            }
          ],
          "reviews": {
            "results": [
              {
                "title": "<string>",
                "description": "<string>",
                "date": "<string>",
                "rating": {
                  "ratingValue": 0,
                  "bestRating": 0,
                  "reviewCount": 0,
                  "profile": {
                    "name": "<string>",
                    "url": "<string>",
                    "long_name": "<string>",
                    "img": "<string>"
                  },
                  "is_tripadvisor": false
                },
                "author": {
                  "type": "person",
                  "name": "<string>",
                  "url": "<string>",
                  "thumbnail": {
                    "src": "<string>",
                    "alt": "<string>",
                    "height": 0,
                    "width": 0,
                    "bg_color": "<string>",
                    "original": "<string>",
                    "logo": false,
                    "duplicated": false,
                    "theme": "<string>"
                  },
                  "email": "<string>"
                },
                "review_url": "<string>",
                "language": "<string>"
              }
            ],
            "viewMoreUrl": "<string>",
            "reviews_in_foreign_language": false
          },
          "pictures": {
            "viewMoreUrl": "<string>",
            "results": [
              {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              }
            ]
          },
          "action": {
            "type": "<string>",
            "url": "<string>"
          },
          "serves_cuisine": [
            "<string>"
          ],
          "categories": [
            "<string>"
          ],
          "icon_category": "<string>",
          "timezone": "<string>",
          "timezone_offset": 0,
          "id": "<string>",
          "results": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "video": {
          "duration": "<string>",
          "views": "<string>",
          "creator": "<string>",
          "publisher": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "tags": [
            "<string>"
          ],
          "author": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "requires_subscription": false
        },
        "movie": {
          "name": "<string>",
          "description": "<string>",
          "url": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "release": "<string>",
          "directors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "actors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "duration": "<string>",
          "genre": [
            "<string>"
          ],
          "query": "<string>"
        },
        "faq": {
          "items": [
            {
              "question": "<string>",
              "answer": "<string>",
              "title": "<string>",
              "url": "<string>",
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "qa": {
          "question": "<string>",
          "answer": {
            "text": "<string>",
            "author": "<string>",
            "upvoteCount": 0,
            "downvoteCount": 0
          }
        },
        "book": {
          "title": "<string>",
          "author": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "date": "<string>",
          "price": {
            "price": "<string>",
            "priceCurrency": "<string>"
          },
          "pages": 0,
          "publisher": {
            "type": "person",
            "name": "<string>",
            "url": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "email": "<string>"
          },
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          }
        },
        "rating": {
          "ratingValue": 0,
          "bestRating": 0,
          "reviewCount": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "is_tripadvisor": false
        },
        "article": {
          "author": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "date": "<string>",
          "publisher": {
            "type": "<string>",
            "name": "<string>",
            "url": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "contact_points": [
              {
                "type": "<string>",
                "name": "<string>",
                "url": "<string>",
                "thumbnail": {
                  "src": "<string>",
                  "alt": "<string>",
                  "height": 0,
                  "width": 0,
                  "bg_color": "<string>",
                  "original": "<string>",
                  "logo": false,
                  "duplicated": false,
                  "theme": "<string>"
                },
                "telephone": "<string>",
                "email": "<string>"
              }
            ]
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "isAccessibleForFree": false
        },
        "product": {
          "type": "Product",
          "name": "<string>",
          "url": "<string>",
          "category": "<string>",
          "price": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "description": "<string>",
          "offers": [
            {
              "url": "<string>",
              "priceCurrency": "<string>",
              "price": "<string>"
            }
          ],
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "gtin": "<string>",
          "gtin8": "<string>",
          "gtin12": "<string>",
          "gtin13": "<string>",
          "gtin14": "<string>"
        },
        "product_cluster": [
          {
            "type": "Product",
            "name": "<string>",
            "url": "<string>",
            "category": "<string>",
            "price": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "description": "<string>",
            "offers": [
              {
                "url": "<string>",
                "priceCurrency": "<string>",
                "price": "<string>"
              }
            ],
            "rating": {
              "ratingValue": 0,
              "bestRating": 0,
              "reviewCount": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "is_tripadvisor": false
            },
            "gtin": "<string>",
            "gtin8": "<string>",
            "gtin12": "<string>",
            "gtin13": "<string>",
            "gtin14": "<string>"
          }
        ],
        "cluster_type": "<string>",
        "cluster": [
          {
            "title": "<string>",
            "url": "<string>",
            "is_source_local": false,
            "is_source_both": false,
            "description": "<string>",
            "page_age": "<string>",
            "page_fetched": "<string>",
            "fetched_content_timestamp": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "language": "<string>",
            "family_friendly": false
          }
        ],
        "creative_work": {
          "name": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          }
        },
        "music_recording": {
          "name": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          }
        },
        "review": {
          "type": "Review",
          "name": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "description": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          }
        },
        "recipe": {
          "title": "<string>",
          "description": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "url": "<string>",
          "domain": "<string>",
          "favicon": "<string>",
          "time": "<string>",
          "prep_time": "<string>",
          "cook_time": "<string>",
          "ingredients": "<string>",
          "instructions": [
            {
              "text": "<string>",
              "name": "<string>",
              "url": "<string>",
              "image": [
                "<string>"
              ]
            }
          ],
          "servings": 0,
          "calories": 0,
          "publisher": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "recipeCategory": "<string>",
          "recipeCuisine": "<string>",
          "video": {
            "duration": "<string>",
            "views": "<string>",
            "creator": "<string>",
            "publisher": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "tags": [
              "<string>"
            ],
            "author": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "requires_subscription": false
          }
        },
        "software": {
          "name": "<string>",
          "author": "<string>",
          "version": "<string>",
          "codeRepository": "<string>",
          "homepage": "<string>",
          "datePublished": "<string>",
          "is_npm": false,
          "is_pypi": false,
          "stars": 0,
          "forks": 0,
          "programmingLanguage": "<string>"
        },
        "organization": {
          "type": "<string>",
          "name": "<string>",
          "url": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "contact_points": [
            {
              "type": "<string>",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "telephone": "<string>",
              "email": "<string>"
            }
          ]
        },
        "content_type": "<string>",
        "extra_snippets": [
          "<string>"
        ],
        "icons": [
          {
            "href": "<string>",
            "sizes": "<string>",
            "rel": "<string>",
            "type": "<string>",
            "ext": "<string>"
          }
        ],
        "data": {
          "forum_name": "<string>",
          "num_answers": 0,
          "score": "<string>",
          "title": "<string>",
          "question": "<string>",
          "top_comment": "<string>"
        }
      }
    ],
    "mutated_by_goggles": false
  },
  "faq": {
    "type": "faq",
    "results": [
      {
        "question": "<string>",
        "answer": "<string>",
        "title": "<string>",
        "url": "<string>",
        "meta_url": {
          "scheme": "<string>",
          "netloc": "<string>",
          "hostname": "<string>",
          "favicon": "<string>",
          "path": "<string>"
        }
      }
    ]
  },
  "infobox": {
    "type": "graph",
    "results": [
      {
        "title": "<string>",
        "url": "<string>",
        "is_source_local": false,
        "is_source_both": false,
        "description": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "profile": {
          "name": "<string>",
          "url": "<string>",
          "long_name": "<string>",
          "img": "<string>"
        },
        "language": "<string>",
        "family_friendly": false,
        "type": "infobox",
        "position": 0,
        "label": "<string>",
        "category": "<string>",
        "long_desc": "<string>",
        "thumbnail": {
          "src": "<string>",
          "alt": "<string>",
          "height": 0,
          "width": 0,
          "bg_color": "<string>",
          "original": "<string>",
          "logo": false,
          "duplicated": false,
          "theme": "<string>"
        },
        "attributes": [
          [
            "<string>"
          ]
        ],
        "profiles": [
          {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          }
        ],
        "website_url": "<string>",
        "ratings": [
          {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          }
        ],
        "providers": [
          {
            "type": "external",
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          }
        ],
        "distance": {
          "value": 0,
          "units": "<string>"
        },
        "images": [
          {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          }
        ],
        "movie": {
          "name": "<string>",
          "description": "<string>",
          "url": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "release": "<string>",
          "directors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "actors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "duration": "<string>",
          "genre": [
            "<string>"
          ],
          "query": "<string>"
        },
        "subtype": "generic",
        "found_in_urls": [
          "<string>"
        ]
      }
    ]
  },
  "locations": {
    "type": "locations",
    "results": [
      {
        "title": "<string>",
        "url": "<string>",
        "is_source_local": false,
        "is_source_both": false,
        "description": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "profile": {
          "name": "<string>",
          "url": "<string>",
          "long_name": "<string>",
          "img": "<string>"
        },
        "language": "<string>",
        "family_friendly": false,
        "type": "location_result",
        "provider_url": "<string>",
        "coordinates": [],
        "zoom_level": 0,
        "thumbnail": {
          "src": "<string>",
          "alt": "<string>",
          "height": 0,
          "width": 0,
          "bg_color": "<string>",
          "original": "<string>",
          "logo": false,
          "duplicated": false,
          "theme": "<string>"
        },
        "postal_address": {
          "type": "PostalAddress",
          "country": "<string>",
          "postalCode": "<string>",
          "streetAddress": "<string>",
          "addressRegion": "<string>",
          "addressLocality": "<string>",
          "displayAddress": "<string>"
        },
        "opening_hours": {
          "current_day": [
            {
              "abbr_name": "<string>",
              "full_name": "<string>",
              "opens": "<string>",
              "closes": "<string>"
            }
          ],
          "days": [
            [
              {
                "abbr_name": "<string>",
                "full_name": "<string>",
                "opens": "<string>",
                "closes": "<string>"
              }
            ]
          ]
        },
        "contact": {
          "email": "<string>",
          "telephone": "<string>"
        },
        "price_range": "<string>",
        "rating": {
          "ratingValue": 0,
          "bestRating": 0,
          "reviewCount": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "is_tripadvisor": false
        },
        "distance": {
          "value": 0,
          "units": "<string>"
        },
        "profiles": [
          {
            "type": "external",
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          }
        ],
        "reviews": {
          "results": [
            {
              "title": "<string>",
              "description": "<string>",
              "date": "<string>",
              "rating": {
                "ratingValue": 0,
                "bestRating": 0,
                "reviewCount": 0,
                "profile": {
                  "name": "<string>",
                  "url": "<string>",
                  "long_name": "<string>",
                  "img": "<string>"
                },
                "is_tripadvisor": false
              },
              "author": {
                "type": "person",
                "name": "<string>",
                "url": "<string>",
                "thumbnail": {
                  "src": "<string>",
                  "alt": "<string>",
                  "height": 0,
                  "width": 0,
                  "bg_color": "<string>",
                  "original": "<string>",
                  "logo": false,
                  "duplicated": false,
                  "theme": "<string>"
                },
                "email": "<string>"
              },
              "review_url": "<string>",
              "language": "<string>"
            }
          ],
          "viewMoreUrl": "<string>",
          "reviews_in_foreign_language": false
        },
        "pictures": {
          "viewMoreUrl": "<string>",
          "results": [
            {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            }
          ]
        },
        "action": {
          "type": "<string>",
          "url": "<string>"
        },
        "serves_cuisine": [
          "<string>"
        ],
        "categories": [
          "<string>"
        ],
        "icon_category": "<string>",
        "timezone": "<string>",
        "timezone_offset": 0,
        "id": "<string>",
        "results": [
          {
            "title": "<string>",
            "url": "<string>",
            "is_source_local": false,
            "is_source_both": false,
            "description": "<string>",
            "page_age": "<string>",
            "page_fetched": "<string>",
            "fetched_content_timestamp": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "language": "<string>",
            "family_friendly": false,
            "meta_url": {
              "scheme": "<string>",
              "netloc": "<string>",
              "hostname": "<string>",
              "favicon": "<string>",
              "path": "<string>"
            }
          }
        ]
      }
    ],
    "provider": {}
  },
  "mixed": {
    "type": "mixed",
    "main": [
      {
        "type": "<string>",
        "index": 0,
        "all": false
      }
    ],
    "top": [
      {
        "type": "<string>",
        "index": 0,
        "all": false
      }
    ],
    "side": [
      {
        "type": "<string>",
        "index": 0,
        "all": false
      }
    ]
  },
  "news": {
    "type": "news",
    "results": [
      {
        "title": "<string>",
        "url": "<string>",
        "is_source_local": false,
        "is_source_both": false,
        "description": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "profile": {
          "name": "<string>",
          "url": "<string>",
          "long_name": "<string>",
          "img": "<string>"
        },
        "language": "<string>",
        "family_friendly": false,
        "meta_url": {},
        "source": "<string>",
        "breaking": false,
        "is_live": false,
        "thumbnail": {
          "src": "<string>",
          "alt": "<string>",
          "height": 0,
          "width": 0,
          "bg_color": "<string>",
          "original": "<string>",
          "logo": false,
          "duplicated": false,
          "theme": "<string>"
        },
        "age": "<string>",
        "extra_snippets": [
          "<string>"
        ],
        "icons": [
          {
            "href": "<string>",
            "sizes": "<string>",
            "rel": "<string>",
            "type": "<string>",
            "ext": "<string>"
          }
        ]
      }
    ],
    "mutated_by_goggles": false
  },
  "videos": {
    "type": "videos",
    "results": [
      {
        "type": "video_result",
        "url": "<string>",
        "title": "<string>",
        "description": "<string>",
        "age": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "video": {
          "duration": "<string>",
          "views": 0,
          "creator": "<string>",
          "publisher": "<string>",
          "requires_subscription": false,
          "tags": [
            "<string>"
          ],
          "author": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          }
        },
        "meta_url": {
          "scheme": "<string>",
          "netloc": "<string>",
          "hostname": "<string>",
          "favicon": "<string>",
          "path": "<string>"
        },
        "thumbnail": {
          "src": "<string>",
          "original": "<string>"
        }
      }
    ],
    "mutated_by_goggles": false
  },
  "web": {
    "type": "search",
    "results": [
      {
        "title": "<string>",
        "url": "<string>",
        "is_source_local": false,
        "is_source_both": false,
        "description": "<string>",
        "page_age": "<string>",
        "page_fetched": "<string>",
        "fetched_content_timestamp": 0,
        "profile": {
          "name": "<string>",
          "url": "<string>",
          "long_name": "<string>",
          "img": "<string>"
        },
        "language": "<string>",
        "family_friendly": false,
        "type": "search_result",
        "subtype": "<string>",
        "is_live": false,
        "deep_results": {
          "news": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {},
              "source": "<string>",
              "breaking": false,
              "is_live": false,
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "age": "<string>",
              "extra_snippets": [
                "<string>"
              ],
              "icons": [
                {
                  "href": "<string>",
                  "sizes": "<string>",
                  "rel": "<string>",
                  "type": "<string>",
                  "ext": "<string>"
                }
              ]
            }
          ],
          "buttons": [
            {
              "type": "button_result",
              "title": "<string>",
              "url": "<string>"
            }
          ],
          "videos": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "type": "video_result",
              "video": {
                "duration": "<string>",
                "views": "<string>",
                "creator": "<string>",
                "publisher": "<string>",
                "thumbnail": {
                  "src": "<string>",
                  "alt": "<string>",
                  "height": 0,
                  "width": 0,
                  "bg_color": "<string>",
                  "original": "<string>",
                  "logo": false,
                  "duplicated": false,
                  "theme": "<string>"
                },
                "tags": [
                  "<string>"
                ],
                "author": {
                  "name": "<string>",
                  "url": "<string>",
                  "long_name": "<string>",
                  "img": "<string>"
                },
                "requires_subscription": false
              },
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              },
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "age": "<string>",
              "publisher": "<string>"
            }
          ],
          "images": [
            {
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "url": "<string>",
              "properties": {
                "url": "<string>",
                "resized": "<string>",
                "placeholder": "<string>",
                "height": 0,
                "width": 0,
                "format": "<string>",
                "content_size": "<string>"
              }
            }
          ]
        },
        "schemas": [],
        "meta_url": {},
        "thumbnail": {
          "src": "<string>",
          "alt": "<string>",
          "height": 0,
          "width": 0,
          "bg_color": "<string>",
          "original": "<string>",
          "logo": false,
          "duplicated": false,
          "theme": "<string>"
        },
        "age": "<string>",
        "location": {
          "title": "<string>",
          "url": "<string>",
          "is_source_local": false,
          "is_source_both": false,
          "description": "<string>",
          "page_age": "<string>",
          "page_fetched": "<string>",
          "fetched_content_timestamp": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "language": "<string>",
          "family_friendly": false,
          "type": "location_result",
          "provider_url": "<string>",
          "coordinates": [],
          "zoom_level": 0,
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "postal_address": {
            "type": "PostalAddress",
            "country": "<string>",
            "postalCode": "<string>",
            "streetAddress": "<string>",
            "addressRegion": "<string>",
            "addressLocality": "<string>",
            "displayAddress": "<string>"
          },
          "opening_hours": {
            "current_day": [
              {
                "abbr_name": "<string>",
                "full_name": "<string>",
                "opens": "<string>",
                "closes": "<string>"
              }
            ],
            "days": [
              [
                {
                  "abbr_name": "<string>",
                  "full_name": "<string>",
                  "opens": "<string>",
                  "closes": "<string>"
                }
              ]
            ]
          },
          "contact": {
            "email": "<string>",
            "telephone": "<string>"
          },
          "price_range": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "distance": {
            "value": 0,
            "units": "<string>"
          },
          "profiles": [
            {
              "type": "external",
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            }
          ],
          "reviews": {
            "results": [
              {
                "title": "<string>",
                "description": "<string>",
                "date": "<string>",
                "rating": {
                  "ratingValue": 0,
                  "bestRating": 0,
                  "reviewCount": 0,
                  "profile": {
                    "name": "<string>",
                    "url": "<string>",
                    "long_name": "<string>",
                    "img": "<string>"
                  },
                  "is_tripadvisor": false
                },
                "author": {
                  "type": "person",
                  "name": "<string>",
                  "url": "<string>",
                  "thumbnail": {
                    "src": "<string>",
                    "alt": "<string>",
                    "height": 0,
                    "width": 0,
                    "bg_color": "<string>",
                    "original": "<string>",
                    "logo": false,
                    "duplicated": false,
                    "theme": "<string>"
                  },
                  "email": "<string>"
                },
                "review_url": "<string>",
                "language": "<string>"
              }
            ],
            "viewMoreUrl": "<string>",
            "reviews_in_foreign_language": false
          },
          "pictures": {
            "viewMoreUrl": "<string>",
            "results": [
              {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              }
            ]
          },
          "action": {
            "type": "<string>",
            "url": "<string>"
          },
          "serves_cuisine": [
            "<string>"
          ],
          "categories": [
            "<string>"
          ],
          "icon_category": "<string>",
          "timezone": "<string>",
          "timezone_offset": 0,
          "id": "<string>",
          "results": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "restaurant": {
          "title": "<string>",
          "url": "<string>",
          "is_source_local": false,
          "is_source_both": false,
          "description": "<string>",
          "page_age": "<string>",
          "page_fetched": "<string>",
          "fetched_content_timestamp": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "language": "<string>",
          "family_friendly": false,
          "type": "location_result",
          "provider_url": "<string>",
          "coordinates": [],
          "zoom_level": 0,
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "postal_address": {
            "type": "PostalAddress",
            "country": "<string>",
            "postalCode": "<string>",
            "streetAddress": "<string>",
            "addressRegion": "<string>",
            "addressLocality": "<string>",
            "displayAddress": "<string>"
          },
          "opening_hours": {
            "current_day": [
              {
                "abbr_name": "<string>",
                "full_name": "<string>",
                "opens": "<string>",
                "closes": "<string>"
              }
            ],
            "days": [
              [
                {
                  "abbr_name": "<string>",
                  "full_name": "<string>",
                  "opens": "<string>",
                  "closes": "<string>"
                }
              ]
            ]
          },
          "contact": {
            "email": "<string>",
            "telephone": "<string>"
          },
          "price_range": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "distance": {
            "value": 0,
            "units": "<string>"
          },
          "profiles": [
            {
              "type": "external",
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            }
          ],
          "reviews": {
            "results": [
              {
                "title": "<string>",
                "description": "<string>",
                "date": "<string>",
                "rating": {
                  "ratingValue": 0,
                  "bestRating": 0,
                  "reviewCount": 0,
                  "profile": {
                    "name": "<string>",
                    "url": "<string>",
                    "long_name": "<string>",
                    "img": "<string>"
                  },
                  "is_tripadvisor": false
                },
                "author": {
                  "type": "person",
                  "name": "<string>",
                  "url": "<string>",
                  "thumbnail": {
                    "src": "<string>",
                    "alt": "<string>",
                    "height": 0,
                    "width": 0,
                    "bg_color": "<string>",
                    "original": "<string>",
                    "logo": false,
                    "duplicated": false,
                    "theme": "<string>"
                  },
                  "email": "<string>"
                },
                "review_url": "<string>",
                "language": "<string>"
              }
            ],
            "viewMoreUrl": "<string>",
            "reviews_in_foreign_language": false
          },
          "pictures": {
            "viewMoreUrl": "<string>",
            "results": [
              {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              }
            ]
          },
          "action": {
            "type": "<string>",
            "url": "<string>"
          },
          "serves_cuisine": [
            "<string>"
          ],
          "categories": [
            "<string>"
          ],
          "icon_category": "<string>",
          "timezone": "<string>",
          "timezone_offset": 0,
          "id": "<string>",
          "results": [
            {
              "title": "<string>",
              "url": "<string>",
              "is_source_local": false,
              "is_source_both": false,
              "description": "<string>",
              "page_age": "<string>",
              "page_fetched": "<string>",
              "fetched_content_timestamp": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "language": "<string>",
              "family_friendly": false,
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "video": {
          "duration": "<string>",
          "views": "<string>",
          "creator": "<string>",
          "publisher": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "tags": [
            "<string>"
          ],
          "author": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "requires_subscription": false
        },
        "movie": {
          "name": "<string>",
          "description": "<string>",
          "url": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "release": "<string>",
          "directors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "actors": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "duration": "<string>",
          "genre": [
            "<string>"
          ],
          "query": "<string>"
        },
        "faq": {
          "items": [
            {
              "question": "<string>",
              "answer": "<string>",
              "title": "<string>",
              "url": "<string>",
              "meta_url": {
                "scheme": "<string>",
                "netloc": "<string>",
                "hostname": "<string>",
                "favicon": "<string>",
                "path": "<string>"
              }
            }
          ]
        },
        "qa": {
          "question": "<string>",
          "answer": {
            "text": "<string>",
            "author": "<string>",
            "upvoteCount": 0,
            "downvoteCount": 0
          }
        },
        "book": {
          "title": "<string>",
          "author": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "date": "<string>",
          "price": {
            "price": "<string>",
            "priceCurrency": "<string>"
          },
          "pages": 0,
          "publisher": {
            "type": "person",
            "name": "<string>",
            "url": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "email": "<string>"
          },
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          }
        },
        "rating": {
          "ratingValue": 0,
          "bestRating": 0,
          "reviewCount": 0,
          "profile": {
            "name": "<string>",
            "url": "<string>",
            "long_name": "<string>",
            "img": "<string>"
          },
          "is_tripadvisor": false
        },
        "article": {
          "author": [
            {
              "type": "person",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "email": "<string>"
            }
          ],
          "date": "<string>",
          "publisher": {
            "type": "<string>",
            "name": "<string>",
            "url": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "contact_points": [
              {
                "type": "<string>",
                "name": "<string>",
                "url": "<string>",
                "thumbnail": {
                  "src": "<string>",
                  "alt": "<string>",
                  "height": 0,
                  "width": 0,
                  "bg_color": "<string>",
                  "original": "<string>",
                  "logo": false,
                  "duplicated": false,
                  "theme": "<string>"
                },
                "telephone": "<string>",
                "email": "<string>"
              }
            ]
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "isAccessibleForFree": false
        },
        "product": {
          "type": "Product",
          "name": "<string>",
          "url": "<string>",
          "category": "<string>",
          "price": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "description": "<string>",
          "offers": [
            {
              "url": "<string>",
              "priceCurrency": "<string>",
              "price": "<string>"
            }
          ],
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "gtin": "<string>",
          "gtin8": "<string>",
          "gtin12": "<string>",
          "gtin13": "<string>",
          "gtin14": "<string>"
        },
        "product_cluster": [
          {
            "type": "Product",
            "name": "<string>",
            "url": "<string>",
            "category": "<string>",
            "price": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "description": "<string>",
            "offers": [
              {
                "url": "<string>",
                "priceCurrency": "<string>",
                "price": "<string>"
              }
            ],
            "rating": {
              "ratingValue": 0,
              "bestRating": 0,
              "reviewCount": 0,
              "profile": {
                "name": "<string>",
                "url": "<string>",
                "long_name": "<string>",
                "img": "<string>"
              },
              "is_tripadvisor": false
            },
            "gtin": "<string>",
            "gtin8": "<string>",
            "gtin12": "<string>",
            "gtin13": "<string>",
            "gtin14": "<string>"
          }
        ],
        "cluster_type": "<string>",
        "cluster": [
          {
            "title": "<string>",
            "url": "<string>",
            "is_source_local": false,
            "is_source_both": false,
            "description": "<string>",
            "page_age": "<string>",
            "page_fetched": "<string>",
            "fetched_content_timestamp": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "language": "<string>",
            "family_friendly": false
          }
        ],
        "creative_work": {
          "name": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          }
        },
        "music_recording": {
          "name": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          }
        },
        "review": {
          "type": "Review",
          "name": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "description": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          }
        },
        "recipe": {
          "title": "<string>",
          "description": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "url": "<string>",
          "domain": "<string>",
          "favicon": "<string>",
          "time": "<string>",
          "prep_time": "<string>",
          "cook_time": "<string>",
          "ingredients": "<string>",
          "instructions": [
            {
              "text": "<string>",
              "name": "<string>",
              "url": "<string>",
              "image": [
                "<string>"
              ]
            }
          ],
          "servings": 0,
          "calories": 0,
          "publisher": "<string>",
          "rating": {
            "ratingValue": 0,
            "bestRating": 0,
            "reviewCount": 0,
            "profile": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "is_tripadvisor": false
          },
          "recipeCategory": "<string>",
          "recipeCuisine": "<string>",
          "video": {
            "duration": "<string>",
            "views": "<string>",
            "creator": "<string>",
            "publisher": "<string>",
            "thumbnail": {
              "src": "<string>",
              "alt": "<string>",
              "height": 0,
              "width": 0,
              "bg_color": "<string>",
              "original": "<string>",
              "logo": false,
              "duplicated": false,
              "theme": "<string>"
            },
            "tags": [
              "<string>"
            ],
            "author": {
              "name": "<string>",
              "url": "<string>",
              "long_name": "<string>",
              "img": "<string>"
            },
            "requires_subscription": false
          }
        },
        "software": {
          "name": "<string>",
          "author": "<string>",
          "version": "<string>",
          "codeRepository": "<string>",
          "homepage": "<string>",
          "datePublished": "<string>",
          "is_npm": false,
          "is_pypi": false,
          "stars": 0,
          "forks": 0,
          "programmingLanguage": "<string>"
        },
        "organization": {
          "type": "<string>",
          "name": "<string>",
          "url": "<string>",
          "thumbnail": {
            "src": "<string>",
            "alt": "<string>",
            "height": 0,
            "width": 0,
            "bg_color": "<string>",
            "original": "<string>",
            "logo": false,
            "duplicated": false,
            "theme": "<string>"
          },
          "contact_points": [
            {
              "type": "<string>",
              "name": "<string>",
              "url": "<string>",
              "thumbnail": {
                "src": "<string>",
                "alt": "<string>",
                "height": 0,
                "width": 0,
                "bg_color": "<string>",
                "original": "<string>",
                "logo": false,
                "duplicated": false,
                "theme": "<string>"
              },
              "telephone": "<string>",
              "email": "<string>"
            }
          ]
        },
        "content_type": "<string>",
        "extra_snippets": [
          "<string>"
        ],
        "icons": [
          {
            "href": "<string>",
            "sizes": "<string>",
            "rel": "<string>",
            "type": "<string>",
            "ext": "<string>"
          }
        ]
      }
    ],
    "family_friendly": false
  },
  "summarizer": {
    "type": "summarizer",
    "key": "<string>"
  },
  "rich": {
    "type": "rich",
    "hint": {
      "vertical": "calculator",
      "callback_key": "<string>"
    }
  }
}

Exa Search API — 每月 1000 次免费，超低延迟  https://exa.ai/docs/reference/search

curl -X POST 'https://api.exa.ai/search' \
  -H 'x-api-key: YOUR-EXA-API-KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Latest research in LLMs",
    "contents": {
      "highlights": true
    }
  }'

{
  "results": [
    {
      "title": "A Comprehensive Overview of Large Language Models",
      "url": "https://arxiv.org/pdf/2307.06435.pdf",
      "publishedDate": "2023-11-16T01:36:32.547Z",
      "author": "Humza Naveed",
      "id": "https://arxiv.org/abs/2307.06435",
      "image": "https://arxiv.org/pdf/2307.06435.pdf/page_1.png",
      "favicon": "https://arxiv.org/favicon.ico",
      "text": "Abstract Large Language Models (LLMs) have recently demonstrated remarkable capabilities...",
      "highlights": [
        "Such requirements have limited their adoption..."
      ],
      "highlightScores": [
        0.4600165784358978
      ],
      "summary": "This overview paper on Large Language Models (LLMs) highlights key developments...",
      "subpages": [
        {
          "title": "A Comprehensive Overview of Large Language Models",
          "url": "https://arxiv.org/pdf/2307.06435.pdf",
          "publishedDate": "2023-11-16T01:36:32.547Z",
          "author": "Humza Naveed",
          "id": "https://arxiv.org/abs/2307.06435",
          "image": "https://arxiv.org/pdf/2307.06435.pdf/page_1.png",
          "favicon": "https://arxiv.org/favicon.ico"
        }
      ],
      "entities": [
        {
          "id": "<string>",
          "type": "<string>",
          "version": 2,
          "properties": {
            "name": "<string>",
            "foundedYear": 123,
            "description": "<string>",
            "workforce": {
              "total": 123
            },
            "headquarters": {
              "address": "<string>",
              "city": "<string>",
              "postalCode": "<string>",
              "country": "<string>"
            },
            "financials": {
              "revenueAnnual": 123,
              "fundingTotal": 123,
              "fundingLatestRound": {
                "name": "<string>",
                "date": "<string>",
                "amount": 123
              }
            },
            "webTraffic": {
              "visitsMonthly": 123,
              "countryRank": 123,
              "avgDurationSeconds": 123,
              "history": [
                {
                  "value": 123,
                  "dateFrom": "<string>",
                  "dateTo": "<string>"
                }
              ]
            }
          }
        }
      ],
      "extras": {
        "links": []
      }
    }
  ],
  "output": {
    "content": "<string>",
    "grounding": [
      {
        "field": "<string>",
        "citations": [
          {
            "url": "<string>",
            "title": "<string>"
          }
        ]
      }
    ]
  },
  "requestId": "b5947044c4b78efa9552a7c89b306d95",
  "resolvedSearchType": "",
  "context": "<string>",
  "costDollars": {
    "total": 0.007,
    "search": {
      "neural": 0.007
    }
  }
}

Serper API — Google 搜索结果，首次 2500 次免费  https://serper.dev

curl -s --request POST --url "https://google.serper.dev/search" --header "X-API-KEY: $SERPER_API_KEY" --header "Content-Type: application/json" --data "$REQUEST_BODY"

Tavily Search API — 每月 1000 次免费  文档: https://docs.tavily.com/documentation/api-reference/endpoint/search

curl --request POST \
  --url https://api.tavily.com/search \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "query": "who is Leo Messi?",
  "search_depth": "basic",
  "chunks_per_source": 3,
  "max_results": 1,
  "topic": "general",
  "time_range": null,
  "start_date": "2025-02-09",
  "end_date": "2025-12-29",
  "include_answer": false,
  "include_raw_content": false,
  "include_images": false,
  "include_image_descriptions": false,
  "include_favicon": false,
  "include_domains": [],
  "exclude_domains": [],
  "country": null,
  "auto_parameters": false,
  "exact_match": false,
  "include_usage": false,
  "safe_search": false
}
'

{
  "query": "Who is Leo Messi?",
  "answer": "Lionel Messi, born in 1987, is an Argentine footballer widely regarded as one of the greatest players of his generation. He spent the majority of his career playing for FC Barcelona, where he won numerous domestic league titles and UEFA Champions League titles. Messi is known for his exceptional dribbling skills, vision, and goal-scoring ability. He has won multiple FIFA Ballon d'Or awards, numerous La Liga titles with Barcelona, and holds the record for most goals scored in a calendar year. In 2014, he led Argentina to the World Cup final, and in 2015, he helped Barcelona capture another treble. Despite turning 36 in June, Messi remains highly influential in the sport.",
  "images": [],
  "results": [
    {
      "title": "Lionel Messi Facts | Britannica",
      "url": "https://www.britannica.com/facts/Lionel-Messi",
      "content": "Lionel Messi, an Argentine footballer, is widely regarded as one of the greatest football players of his generation. Born in 1987, Messi spent the majority of his career playing for Barcelona, where he won numerous domestic league titles and UEFA Champions League titles. Messi is known for his exceptional dribbling skills, vision, and goal",
      "score": 0.81025416,
      "raw_content": null,
      "favicon": "https://britannica.com/favicon.png",
      "images": [
        {
          "url": "<string>",
          "description": "<string>"
        }
      ]
    }
  ],
  "response_time": "1.67",
  "auto_parameters": {
    "topic": "general",
    "search_depth": "basic"
  },
  "usage": {
    "credits": 1
  },
  "request_id": "123e4567-e89b-12d3-a456-426614174111"
}