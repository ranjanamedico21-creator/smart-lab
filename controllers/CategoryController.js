const Category = require("../models/Category");
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * test category registration page
 */
let getCategoryRegistrationPage = (req,res)=>{
     res.render("createCategory", {title: 'Create Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * send user to home page
 */
let getHomePage =(req,res)=>{
    res.render("home",{title: 'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * category creation for test like mri ,ct
 */
let createCategory =async (req,res)=>{
    let errors= Category.validateUserInput(req);
    let notifications=[]
    if(errors.length > 0){
        notifications.push(createNotification('danger', errors , 'bi-exclamation-triangle-fill'));
        res.render('createCategory',{errors,title: 'Create Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    }
    try {
        var isCategoryExist= await Category.findCategory(req.body.category,'Category')
        const{category}=req.body
        if(isCategoryExist){
           // errors.push({msg:})
            notifications.push(createNotification('danger', 'This category already exist. Kindly create category with other name. ' , 'bi-exclamation-triangle-fill'));
            res.render('createCategory',{notifications,category,title: 'Create Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        }
        else{
            try {
                await Category.createCategory(req)
                //let successes=[]
                //successes.push({msg:'Category Created Successfully.'})
                notifications.push(createNotification('success', 'Category has been created. ' , 'bi-check-circle-fill'));
                var categoryDetails= await Category.getCategoryList();
               // console.log(categoryDetails)
                    res.render('categoryListView',{notifications,categoryDetails,title: 'Category List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
            } catch (error) {
                //errors.push({msg:error})
                notifications.push(createNotification('danger', error.message, 'bi-exclamation-triangle-fill'));
                res.render('createCategory',{notifications,category,title: 'Create Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
            }
            
        }
        
    } catch (error) {
        console.log(error)
    }
        
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * this will give test category list like ct,mri
 */
let getCategoryListView= async (req,res)=>{
    let notifications=[];
        try {
            var categoryDetails= await Category.getCategoryList();
            console.log(categoryDetails)
            res.render('categoryListView',{categoryDetails,title: 'Category List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        } catch (error) {
            notifications.push(createNotification('danger', 'Some error ocurred.Kindly try again.' , 'bi-exclamation-triangle-fill'));
           // errors.push({msg:'Some error ocurred.Kindly try again.'})
            res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
        }
    
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This page is for creating a seperate document category.
 * this is made to store detail about clinical document 
 * this will help us to get registration renewl
 */
let getCreateDocumentCategoryPage = async(req,res)=>{
    res.render('createDocumentCategory',{title: 'Create Document Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * document category
 */
let createDocumentCategory =async (req,res)=>{
    let errors= Category.validateUserInput(req)
    let notifications=[]
    if(errors.length > 0){
        notifications.push(createNotification('danger',errors, 'bi-exclamation-triangle-fill'));
        res.render('createDocumentCategory',{notifications,title: 'Create Document Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    }
    try {
        var isCategoryExist= await Category.findCategory(req.body.category,`DocumentCategory`)
        const{category}=req.body
        if(isCategoryExist){
            //errors.push({msg:'This category already exist. Kindly create category with other name. '})
            notifications.push(createNotification('danger','This category already exist. Kindly create category with other name.', 'bi-exclamation-triangle-fill'));
            res.render('createDocumentCategory',{notifications,category,title: 'Create Document Category',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        }
        else{
            try {
                let messages= await Category.createDocumentCategory(req);
                console.log(messages)
                //let successes=[]
                   // successes.push({msg:messages})
                    notifications.push(createNotification('success', messages, 'bi-check-circle-fill'));
                let DocumentCategoryDetails= await Category.getDocumentCategoryList();
                    res.render('getDocumentCategoryList',{notifications,DocumentCategoryDetails,title: ' Document Category List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
            } catch (error) {
               // let errors=[]
                //errors.push({msg:error})
                notifications.push(createNotification('danger',error.message, 'bi-exclamation-triangle-fill'));
                res.render('getDocumentCategoryList',{errors,category,title: ' Document Category List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
            }
            
        }
        
    } catch (error) {
        console.log(error)
        notifications.push(createNotification('danger', error , 'bi-exclamation-triangle-fill'));
           // errors.push({msg:'Some error ocurred.Kindly try again.'})
            res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    }
        
}

let getDocumentCategoryList = async(req,res)=>{
    try {
        let DocumentCategoryDetails= await Category.getDocumentCategoryList();
        res.render('getDocumentCategoryList',{DocumentCategoryDetails,title: ' Document Category List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
 
    } catch (error) {
        notifications.push(createNotification('danger', error , 'bi-exclamation-triangle-fill'));
           // errors.push({msg:'Some error ocurred.Kindly try again.'})
            res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    }
}

const getEditCategoryPage= async(req,res)=>{
    try {
        const categoryId= req.params.categoryId
        if(!categoryId)
            throw new Error('Category Id is missing.')
        const categoryDetails= await Category.getCategoryById(categoryId)
        if(categoryDetails.length===0)
            throw new Error(`No category found with Id ${categoryId}`)
        res.render('editCategory',{categoryDetails,title: 'Edit Category' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        notifications.push(createNotification('danger', error , 'bi-exclamation-triangle-fill'));
           // errors.push({msg:'Some error ocurred.Kindly try again.'})
            res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
        
    }
}

const updateCategory= async(req,res)=>{

        let notifications=[]
    try {
        const categoryName= req.body.category
        const categoryId=req.params.categoryId
        if(!categoryName || !categoryId)
            throw new Error('Category Id or category name is missing.')
        const message= await Category.updateCategory(categoryName,categoryId);
        const categoryDetails= await Category.getCategoryList()
            notifications.push(createNotification('success',message,'bi-check-circle-fill'))
            res.render('categoryListView',{notifications,categoryDetails,title: 'Category List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        notifications.push(createNotification('danger', error , 'bi-exclamation-triangle-fill'));
           // errors.push({msg:'Some error ocurred.Kindly try again.'})
            res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    }
}

const editDcoumentCategoryPage= async(req,res)=>{
    let notifications=[]
    try {
        const documentCategoryId= req.params.documentCategoryId;
        if(!documentCategoryId) 
            throw new Error('Document category Id is missing.')
        const documentCategoryDetails= await Category.getDocumentCategoryById(documentCategoryId)
            if(!documentCategoryDetails || documentCategoryDetails.length==0)
                    throw new Error(`No document category eixst with this Id ${documentCategoryId}`)
            res.render('editDocumentcategory',{documentCategoryDetails,title: 'Edit document category' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})


    } catch (error) {
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        console.log(error)
        res.render("home",{title: 'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    }
}

const updateDocumentCategory = async (req, res) => {

    let notifications=[]
    try {
      const documentCategoryId = req.params.documentCategoryId;
      if (!documentCategoryId) {
        throw new Error("No category ID provided. Kindly retry.");
      }
  
      const documentCategoryName = req.body.documentCategory;
      if (!documentCategoryName) {
        throw new Error("Document category name is missing.");
      }
  
      const message = await Category.updateDocumentCategory(documentCategoryName, documentCategoryId);
      notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
          res.render('getDocumentCategoryList',{notifications,DocumentCategoryDetails,title: ' Document Category List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
 
  
    } catch (error) {
      // Fix: Use error.message instead of passing error object
      notifications.push(createNotification("danger", error, "bi-exclamation-triangle-fill"));
      console.error(error);
  
      res.render("home", {
        title: "Home",
        notifications,
        BRAND_NAME: process.env.BRAND_NAME,
        layout: "loggedInLayout",
      });
    }
  };
  

/**
 * 
 * @param {*} type 
 * @param {*} messages 
 * @param {*} icon 
 * @returns 
 */
// Centralized notification creation
const createNotification = (type, messages, icon) => ({type,messages,icon,});
module.exports ={
    getCategoryRegistrationPage:getCategoryRegistrationPage,
    getHomePage:getHomePage,
    createCategory:createCategory,
    getCategoryListView:getCategoryListView,
    getCreateDocumentCategoryPage:getCreateDocumentCategoryPage,
    createDocumentCategory:createDocumentCategory,
    getDocumentCategoryList:getDocumentCategoryList,
    getEditCategoryPage:getEditCategoryPage,
    updateCategory:updateCategory,
    editDcoumentCategoryPage:editDcoumentCategoryPage,
    updateDocumentCategory:updateDocumentCategory,
}